import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockQuote } from "@/services/market-data/provider";
import type { NormalizedWalletTransaction, WalletDiscoveryCandidate } from "@/services/blockchain/provider";
import type { CryptoMarketPoint } from "@/services/crypto-market/provider";
import { calculateWalletPnlMetrics, reconstructTradeCycles, POSITION_ENGINE_VERSION, type EnrichedWalletTrade, type TradeCycle } from "@/domain/wallet-pnl";
import { calculateWalletScoreV2, calculateWalletScoreV3 } from "@/domain/wallet-scoring";
import { calculateRugExposure, selectRiskAt, type PointInTimeRisk, type TokenRiskClassification } from "@/domain/token-risk";
import { classifyExecutionCapacity, liquiditySnapshotFromObservation, selectPointInTimeLiquidity, type LiquiditySnapshot } from "@/domain/historical-liquidity";
import { buildRealizedPnlCurve, calculateDrawdown, PERFORMANCE_CURVE_VERSION } from "@/domain/wallet-performance";
import { buildVerificationProgress, calculateDataQualityV3, evaluateWalletVerification, WALLET_VERIFICATION_POLICY } from "@/domain/wallet-verification";
import type { TokenRiskAssessment } from "@/services/token-risk/provider";

const WALLET_ENRICHMENT_VERSION = "wallet-enrichment-v2";

export type JobKind = "stock_quotes" | "wallet_transactions" | "wallet_discovery" | "crypto_market" | "wallet_pnl" | "wallet_evidence" | "fast_flow" | "wallet_clustering" | "jackpot_collector" | "jackpot_outcomes" | "market_events" | "paper_eligibility" | "paper_execution" | "paper_exits" | "paper_valuation" | "performance" | "fx" | "qualification" | "data_gap_closure" | "simulation" | "historical_replay" | "forecast_catalyst";

export class IngestionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async trackedWallets() {
    const { data, error } = await this.db.from("wallets").select("id,address,metadata").eq("is_tracked", true);
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; address: string; metadata: { last_signature?: string; backfill_before?: string; backfill_complete?: boolean } | null }>;
  }

  async saveStockQuotes(quotes: StockQuote[]) {
    for (const quote of quotes) {
      const { data: asset, error: assetError } = await this.db.from("assets").upsert({ kind: "stock", symbol: quote.symbol, name: quote.symbol }, { onConflict: "kind,symbol" }).select("id").single();
      if (assetError) throw assetError;
      const { error } = await this.db.from("market_prices").upsert({ asset_id: asset.id, provider: quote.provider, interval: "quote", captured_at: quote.observedAt, open: quote.open, high: quote.high, low: quote.low, close: quote.price, volume: quote.volume, source_event_id: quote.providerEventId }, { onConflict: "asset_id,provider,interval,captured_at", ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  async saveWalletTransactions(walletId: string, items: NormalizedWalletTransaction[]) {
    let inserted = 0;
    for (const item of items) {
      let assetId: string | null = null;
      if (item.mintAddress) {
        assetId = await this.ensureCryptoAsset(item.mintAddress, item.tokenDecimals);
      }
      const { error } = await this.db.from("wallet_transactions").upsert({ wallet_id: walletId, asset_id: assetId, transaction_hash: item.signature, instruction_index: item.instructionIndex, side: item.side, quantity: item.quantity, block_number: item.slot, occurred_at: item.occurredAt, raw_payload: item.rawPayload }, { onConflict: "transaction_hash,instruction_index,wallet_id", ignoreDuplicates: true });
      if (error) throw error;
      inserted += 1;
    }
    return inserted;
  }


  private async ensureCryptoAsset(mintAddress: string, decimals: number | null) {
    const { data: existing, error: lookupError } = await this.db.from("crypto_tokens").select("asset_id").eq("mint_address", mintAddress).maybeSingle();
    if (lookupError) throw lookupError; if (existing?.asset_id) return existing.asset_id as string;
    const symbol = `SOL-${mintAddress.slice(0, 6)}`;
    const { data: asset, error: assetError } = await this.db.from("assets").upsert({ kind: "crypto", symbol, name: mintAddress, external_id: mintAddress, metadata: { metadata_status: "pending" } }, { onConflict: "kind,symbol" }).select("id").single();
    if (assetError) throw assetError;
    const { error } = await this.db.from("crypto_tokens").upsert({ asset_id: asset.id, chain: "solana", mint_address: mintAddress, decimals, first_seen_at: new Date().toISOString() }, { onConflict: "mint_address" });
    if (error) throw error; return asset.id as string;
  }

  async cryptoTokens() {
    const { data: tokens, error } = await this.db.from("crypto_tokens").select("asset_id,mint_address");
    if (error) throw error; return (tokens ?? []) as Array<{ asset_id: string; mint_address: string }>;
  }

  async walletEvidenceTargets(limit = 10) {
    const { data, error } = await this.db.from("wallet_transactions").select("asset_id,occurred_at").not("asset_id", "is", null).in("side", ["buy", "sell"]).order("occurred_at", { ascending: true });
    if (error) throw error; const tokens = await this.cryptoTokens(); const mintByAsset = new Map(tokens.map((item) => [item.asset_id, item.mint_address]));
    const grouped = new Map<string, { assetId: string; mintAddress: string; from: string; to: string }>();
    for (const row of data ?? []) { const mintAddress = mintByAsset.get(row.asset_id); if (!mintAddress) continue; const current = grouped.get(row.asset_id); if (!current) grouped.set(row.asset_id, { assetId: row.asset_id, mintAddress, from: row.occurred_at, to: row.occurred_at }); else { if (row.occurred_at < current.from) current.from = row.occurred_at; if (row.occurred_at > current.to) current.to = row.occurred_at; } }
    return [...grouped.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)).slice(0, Math.max(1, Math.min(limit, 100)));
  }
  async hasLiquidityEvidence(assetId: string, provider: string, from: string, to: string) { const { count, error } = await this.db.from("crypto_liquidity_snapshots").select("id", { count: "exact", head: true }).eq("asset_id", assetId).eq("provider", provider).gte("effective_at", from).lte("effective_at", to); if (error) throw error; return (count ?? 0) > 0; }
  async hasFreshRiskEvidence(assetId: string, provider: string, since: string) { const { count, error } = await this.db.from("token_risk_assessments").select("id", { count: "exact", head: true }).eq("asset_id", assetId).eq("provider", provider).gte("assessed_at", since); if (error) throw error; return (count ?? 0) > 0; }
  async saveLiquiditySnapshots(snapshots: LiquiditySnapshot[]) { if (!snapshots.length) return 0; const now = new Date().toISOString(); const { error } = await this.db.from("crypto_liquidity_snapshots").upsert(snapshots.map((item) => ({ snapshot_key: `${item.assetId}:${item.provider}:${item.effectiveAt}:${item.poolAddress ?? "token_aggregate"}`, asset_id: item.assetId, pool_address: item.poolAddress, liquidity_usd: item.liquidityUsd, provider: item.provider, selection_version: "latest-effective-highest-liquidity-v1", observed_at: now, effective_at: item.effectiveAt, information_available_at: item.informationAvailableAt, data_quality: item.quality, raw_payload: { scope: item.poolAddress ? "pool" : "token_aggregate" } })), { onConflict: "snapshot_key", ignoreDuplicates: true }); if (error) throw error; return snapshots.length; }
  async saveTokenRiskAssessment(assetId: string, assessment: TokenRiskAssessment) { const { data, error } = await this.db.from("token_risk_assessments").upsert({ asset_id: assetId, provider: assessment.provider, risk_version: assessment.riskVersion, assessed_at: assessment.assessedAt, information_cutoff_at: assessment.informationCutoffAt, information_available_at: assessment.informationAvailableAt, rug_risk_score: assessment.rugRiskScore, rug_status: assessment.rugStatus, risk_components: assessment.riskComponents, data_quality: assessment.dataQuality }, { onConflict: "asset_id,provider,risk_version,information_cutoff_at", ignoreDuplicates: false }).select("id").single(); if (error) throw error;
    const components = (assessment.riskComponents as { components?: Array<{ key: string; value: unknown; status: string; observedAt: string; informationAvailableAt: string; source: string }> }).components ?? [];
    if (components.length) { const { error: componentError } = await this.db.from("token_risk_components").upsert(components.map((item) => ({ assessment_id: data.id, component_key: item.key, component_value: item.value, component_status: item.status, observed_at: item.observedAt, information_available_at: item.informationAvailableAt, source: item.source })), { onConflict: "assessment_id,component_key", ignoreDuplicates: false }); if (componentError) throw componentError; }
    return 1;
  }

  async saveCryptoMarketPoints(points: CryptoMarketPoint[]) {
    const tokens = await this.cryptoTokens(); const assetByMint = new Map(tokens.map((item) => [item.mint_address, item.asset_id])); let saved = 0;
    for (const point of points) { const assetId = assetByMint.get(point.mintAddress); if (!assetId) continue;
      const { error } = await this.db.from("crypto_market_observations").upsert({ asset_id: assetId, provider: point.provider, observed_at: point.observedAt,
        provider_timestamp: point.providerTimestamp, price_usd: point.priceUsd, market_cap_usd: point.marketCapUsd,
        circulating_supply: point.circulatingSupply, liquidity_usd: point.liquidityUsd, volume_24h_usd: point.volume24hUsd,
        pool_address: point.poolAddress, confidence: point.confidence, completeness: point.completeness, raw_payload: point.rawPayload },
      { onConflict: "asset_id,provider,observed_at", ignoreDuplicates: true });
      if (error) throw error;
      const liquidity = liquiditySnapshotFromObservation({ assetId, poolAddress: point.poolAddress, liquidityUsd: point.liquidityUsd,
        observedAt: point.observedAt, provider: point.provider, confidence: point.confidence });
      if (liquidity) await this.saveLiquiditySnapshots([liquidity]);
      saved += 1;
    } return saved;
  }

  async walletTransactionsForEnrichment() {
    const { data: transactions, error } = await this.db.from("wallet_transactions").select("id,wallet_id,asset_id,transaction_hash,instruction_index,side,quantity,occurred_at,raw_payload").not("asset_id", "is", null).in("side", ["buy", "sell"]).order("occurred_at", { ascending: true });
    if (error) throw error; const tokens = await this.cryptoTokens(); const mintByAsset = new Map(tokens.map((item) => [item.asset_id, item.mint_address]));
    return (transactions ?? []).flatMap((item) => { const mintAddress = mintByAsset.get(item.asset_id); return mintAddress ? [{ ...item, mintAddress }] : []; });
  }

  async enrichedTransactionIds(provider: string) {
    const { data, error } = await this.db.from("wallet_transaction_enrichments").select("wallet_transaction_id").eq("provider", provider).eq("enrichment_version", WALLET_ENRICHMENT_VERSION);
    if (error) throw error; return new Set((data ?? []).map((item) => item.wallet_transaction_id as string));
  }

  async saveTransactionEnrichment(input: { transactionId: string; provider: string; tokenPoint: CryptoMarketPoint; solPoint: CryptoMarketPoint; quantity: number; rawFeeLamports: number | null }) {
    const tokenPrice = input.tokenPoint.priceUsd; const solPrice = input.solPoint.priceUsd;
    const feeUsd = input.rawFeeLamports === null || solPrice === null ? null : input.rawFeeLamports / 1e9 * solPrice;
    const pricingCompleteness = tokenPrice !== null && solPrice !== null ? 100 : tokenPrice !== null ? 50 : 0;
    const executionCompleteness = feeUsd === null ? 0 : 100; const informationCompleteness: number = input.tokenPoint.poolAddress ? 50 : 0;
    const status = pricingCompleteness === 100 && executionCompleteness === 100 && informationCompleteness === 100 ? "complete" : pricingCompleteness > 0 ? "partial" : "incomplete";
    const { error } = await this.db.from("wallet_transaction_enrichments").upsert({ wallet_transaction_id: input.transactionId, provider: input.provider,
      enrichment_version: WALLET_ENRICHMENT_VERSION, status, token_price_usd: tokenPrice, sol_price_usd: solPrice,
      estimated_value_usd: tokenPrice === null ? null : input.quantity * tokenPrice, fee_usd: feeUsd, priority_fee_usd: null,
      liquidity_usd: input.tokenPoint.liquidityUsd, market_cap_usd: input.tokenPoint.marketCapUsd,
      price_timestamp: input.tokenPoint.providerTimestamp, known_at: new Date().toISOString(), pricing_completeness: pricingCompleteness,
      execution_completeness: executionCompleteness, information_completeness: informationCompleteness,
      priority_fee_status: "unavailable_from_current_raw_payload", raw_payload: { token: input.tokenPoint.rawPayload, sol: input.solPoint.rawPayload } },
    { onConflict: "wallet_transaction_id,provider,enrichment_version", ignoreDuplicates: true });
    if (error) throw error; return { status };
  }

  async rebuildWalletPnl(provider: string) {
    const transactions = await this.walletTransactionsForEnrichment();
    const { data: enrichments, error } = await this.db.from("wallet_transaction_enrichments").select("wallet_transaction_id,token_price_usd,fee_usd,pricing_completeness,execution_completeness,information_completeness").eq("provider", provider).eq("enrichment_version", WALLET_ENRICHMENT_VERSION);
    if (error) throw error; const enrichmentByTx = new Map((enrichments ?? []).map((item) => [item.wallet_transaction_id, item]));
    const now = new Date().toISOString();
    const [{ data: liquidityRows, error: liquidityError }, { data: assessmentRows, error: assessmentError }] = await Promise.all([
      this.db.from("crypto_liquidity_snapshots").select("id,asset_id,pool_address,liquidity_usd,effective_at,information_available_at,provider,data_quality").lte("information_available_at", now),
      this.db.from("token_risk_assessments").select("asset_id,rug_status,rug_risk_score,information_cutoff_at,information_available_at,data_quality").lte("information_available_at", now),
    ]);
    if (liquidityError) throw liquidityError; if (assessmentError) throw assessmentError;
    const liquiditySnapshots: LiquiditySnapshot[] = (liquidityRows ?? []).map((row) => ({ id: row.id, assetId: row.asset_id, poolAddress: row.pool_address, liquidityUsd: Number(row.liquidity_usd), effectiveAt: row.effective_at, informationAvailableAt: row.information_available_at, provider: row.provider, quality: row.data_quality }));
    const riskAssessments: PointInTimeRisk[] = (assessmentRows ?? []).map((row) => ({ assetId: row.asset_id, status: row.rug_status, score: row.rug_risk_score, informationCutoffAt: row.information_cutoff_at, informationAvailableAt: row.information_available_at, dataQuality: row.data_quality }));
    const groups = new Map<string, typeof transactions>();
    for (const tx of transactions) { const key = `${tx.wallet_id}:${tx.asset_id}`; const values = groups.get(key) ?? []; values.push(tx); groups.set(key, values); }
    const cyclesByWallet = new Map<string, Array<TradeCycle & { id?: string; assetId: string; liquidityQuality: number; capacityRisk: string }>>();
    const riskCyclesByWallet = new Map<string, Array<{ assetId: string; cycle: TradeCycle }>>(); let saved = 0;
    for (const [key, values] of groups) { const [walletId, assetId] = key.split(":");
      const events: EnrichedWalletTrade[] = values.map((tx) => { const enrichment = enrichmentByTx.get(tx.id); return { id: tx.id, signature: tx.transaction_hash,
        instructionIndex: tx.instruction_index, token: tx.mintAddress, side: tx.side as "buy" | "sell", quantity: Number(tx.quantity), occurredAt: tx.occurred_at,
        tokenPriceUsd: enrichment?.token_price_usd === null || enrichment?.token_price_usd === undefined ? null : Number(enrichment.token_price_usd),
        feeUsd: enrichment?.fee_usd === null || enrichment?.fee_usd === undefined ? null : Number(enrichment.fee_usd),
        pricingComplete: enrichment?.pricing_completeness === 100, executionComplete: enrichment?.execution_completeness === 100,
        informationCompleteness: enrichment?.information_completeness ?? 0 }; });
      const cycles = reconstructTradeCycles(events); await this.db.from("wallet_trade_cycles").delete().eq("wallet_id", walletId).eq("asset_id", assetId).eq("engine_version", POSITION_ENGINE_VERSION);
      const contexts = cycles.map((cycle) => { const entry = selectPointInTimeLiquidity(liquiditySnapshots, assetId, cycle.firstEntryAt, cycle.firstEntryAt).snapshot;
        const exit = cycle.finalExitAt ? selectPointInTimeLiquidity(liquiditySnapshots, assetId, cycle.finalExitAt, cycle.finalExitAt).snapshot : null;
        const during = liquiditySnapshots.filter((item) => item.assetId === assetId && item.effectiveAt >= cycle.firstEntryAt && (!cycle.finalExitAt || item.effectiveAt <= cycle.finalExitAt) && item.informationAvailableAt <= item.effectiveAt);
        const capacity = classifyExecutionCapacity(cycle.investedUsd, entry?.liquidityUsd ?? null); return { entry, exit, during, capacity }; });
      let insertedCycles: Array<{ id: string; cycle_number: number }> = [];
      if (cycles.length) { const { data: inserted, error: cycleError } = await this.db.from("wallet_trade_cycles").insert(cycles.map((cycle, index) => ({ wallet_id: walletId, asset_id: assetId,
        cycle_number: cycle.cycleNumber, engine_version: cycle.engineVersion, status: cycle.status, quantity: cycle.quantity, invested_usd: cycle.investedUsd,
        cost_basis_usd: cycle.costBasisUsd, average_entry_usd: cycle.averageEntryUsd, proceeds_usd: cycle.proceedsUsd, realized_pnl_usd: cycle.realizedPnlUsd,
        unrealized_pnl_usd: cycle.unrealizedPnlUsd, return_percent: cycle.returnPercent, first_entry_at: cycle.firstEntryAt, final_exit_at: cycle.finalExitAt,
        holding_seconds: cycle.holdingSeconds, pricing_completeness: cycle.pricingCompleteness, transaction_completeness: cycle.transactionCompleteness,
        execution_completeness: cycle.executionCompleteness, information_completeness: cycle.informationCompleteness,
        entry_liquidity_usd: contexts[index].entry?.liquidityUsd ?? null, exit_liquidity_usd: contexts[index].exit?.liquidityUsd ?? null,
        min_liquidity_during_trade_usd: contexts[index].during.length ? Math.min(...contexts[index].during.map((item) => item.liquidityUsd)) : null,
        max_liquidity_during_trade_usd: contexts[index].during.length ? Math.max(...contexts[index].during.map((item) => item.liquidityUsd)) : null,
        liquidity_source: contexts[index].entry?.provider ?? null, liquidity_observed_at: contexts[index].entry?.effectiveAt ?? null,
        liquidity_data_quality: contexts[index].entry?.quality ?? 0, position_to_liquidity_ratio: contexts[index].capacity.ratio,
        execution_capacity_risk: contexts[index].capacity.risk, data_quality: cycle.dataQuality, transaction_ids: cycle.transactionIds }))).select("id,cycle_number"); if (cycleError) throw cycleError; insertedCycles = inserted ?? []; }
      saved += cycles.length; const walletCycles = cyclesByWallet.get(walletId) ?? []; walletCycles.push(...cycles.map((cycle, index) => ({ ...cycle, id: insertedCycles.find((item) => item.cycle_number === cycle.cycleNumber)?.id, assetId, liquidityQuality: contexts[index].entry?.quality ?? 0, capacityRisk: contexts[index].capacity.risk }))); cyclesByWallet.set(walletId, walletCycles);
      const walletRiskCycles = riskCyclesByWallet.get(walletId) ?? []; walletRiskCycles.push(...cycles.map((item) => ({ assetId, cycle: item }))); riskCyclesByWallet.set(walletId, walletRiskCycles);
    }
    const { data: riskRows, error: riskError } = await this.db.from("token_risk_observations").select("asset_id,classification,known_at").lte("known_at", now).order("known_at", { ascending: false });
    if (riskError) throw riskError; const latestRisk = new Map<string, TokenRiskClassification>();
    for (const row of riskRows ?? []) if (!latestRisk.has(row.asset_id)) latestRisk.set(row.asset_id, row.classification as TokenRiskClassification);
    for (const [walletId, cycles] of cyclesByWallet) { const metrics = calculateWalletPnlMetrics(cycles); const quality = cycles.length ? Math.round(cycles.reduce((sum, cycle) => sum + cycle.dataQuality, 0) / cycles.length) : 0;
      const closedRiskCycles = (riskCyclesByWallet.get(walletId) ?? []).filter((item) => item.cycle.finalExitAt !== null);
      const risk = calculateRugExposure(closedRiskCycles.map((item) => ({ assetId: item.assetId, classification: latestRisk.get(item.assetId) ?? null })));
      const entryRisks = cycles.filter((item) => item.finalExitAt).map((item) => selectRiskAt(riskAssessments, item.assetId, item.firstEntryAt));
      const riskCoverage = entryRisks.length ? Math.round(entryRisks.filter(Boolean).length / entryRisks.length * 100) : 0;
      const rugRate = entryRisks.filter(Boolean).length ? entryRisks.filter((item) => item?.status === "HIGH_RISK" || item?.status === "CONFIRMED_RUG").length / entryRisks.filter(Boolean).length : null;
      const pricingCoverage = cycles.length ? Math.round(cycles.reduce((sum, item) => sum + item.pricingCompleteness, 0) / cycles.length) : 0;
      const liquidityCoverage = cycles.length ? Math.round(cycles.filter((item) => item.liquidityQuality > 0).length / cycles.length * 100) : 0;
      const curve = buildRealizedPnlCurve(cycles); const drawdown = calculateDrawdown(curve);
      await this.db.from("wallet_performance_points").delete().eq("wallet_id", walletId).eq("curve_version", PERFORMANCE_CURVE_VERSION);
      if (curve.length) { const { error: curveError } = await this.db.from("wallet_performance_points").insert(curve.map((point) => ({ wallet_id: walletId, trade_cycle_id: point.tradeCycleId, curve_version: PERFORMANCE_CURVE_VERSION, point_at: point.timestamp, cumulative_realized_pnl_usd: point.cumulativeRealizedPnlUsd, cumulative_return: point.cumulativeReturn, equity_index: point.equityIndex, information_available_at: now }))); if (curveError) throw curveError; }
      const historyDays = cycles.length ? Math.max(0, (new Date(now).getTime() - new Date(cycles.map((item) => item.firstEntryAt).sort()[0]).getTime()) / 86_400_000) : 0;
      const dataQualityV3 = calculateDataQualityV3({ transaction: quality, pricing: pricingCoverage, liquidity: liquidityCoverage, fees: cycles.length ? Math.round(cycles.reduce((sum, item) => sum + item.executionCompleteness, 0) / cycles.length) : 0, priorityFees: 0, risk: riskCoverage, drawdownAvailable: drawdown.status === "available", tradeCycles: quality });
      const verificationInput = { verifiedTradeCycles: metrics.verifiedTrades, overallDataQuality: dataQualityV3, pricingCoverage, liquidityCoverage, riskCoverage, historyDays: Math.floor(historyDays), drawdownAvailable: drawdown.status === "available" };
      const verification = evaluateWalletVerification(verificationInput); const progress = buildVerificationProgress(verificationInput);
      const { error: metricError } = await this.db.from("wallet_metric_snapshots").insert({ wallet_id: walletId, engine_version: POSITION_ENGINE_VERSION,
        scoring_version: "wallet-metrics-v2-preparation", calculated_at: now, information_available_through: now, closed_trades: metrics.closedTrades,
        verified_trades: metrics.verifiedTrades, wins: metrics.wins, losses: metrics.losses, win_rate: metrics.winRate, median_return: metrics.medianReturn,
        mean_return: metrics.meanReturn, realized_pnl_usd: metrics.realizedPnlUsd, best_trade_percent: metrics.bestTradePercent,
        worst_trade_percent: metrics.worstTradePercent, median_holding_seconds: metrics.medianHoldingSeconds, data_quality: quality,
        max_drawdown: drawdown.maxDrawdownPercent, max_drawdown_usd: drawdown.maxDrawdownUsd, drawdown_status: drawdown.status,
        drawdown_start_at: drawdown.startAt, drawdown_bottom_at: drawdown.bottomAt, drawdown_recovered_at: drawdown.recoveredAt,
        rug_exposure_rate: rugRate, rug_assessed_trades: entryRisks.filter(Boolean).length, risk_data_quality: riskCoverage,
        pricing_coverage: pricingCoverage, liquidity_coverage: liquidityCoverage, metrics: { ...metrics, rugExposure: risk, dataQualityV3, verification } }); if (metricError) throw metricError;
      const score = calculateWalletScoreV2({ closedTrades: metrics.closedTrades, verifiedTrades: metrics.verifiedTrades, winRate: metrics.winRate,
        medianReturn: metrics.medianReturn, realizedPnlUsd: metrics.realizedPnlUsd, maxDrawdown: metrics.maxDrawdown, rugExposureRate: risk.rugExposureRate,
        medianHoldingSeconds: metrics.medianHoldingSeconds, overallDataQuality: quality });
      const { error: scoreError } = await this.db.from("wallet_scores").insert({ wallet_id: walletId, score: score.score, data_quality: score.dataQuality,
        scoring_version: score.version, components: { components: score.components, missing_components: score.missingComponents, lifecycle: score.lifecycle },
        calculated_at: now, data_cutoff_at: now, lifecycle: score.lifecycle }); if (scoreError) throw scoreError;
      const knownCapacity = cycles.filter((item) => item.capacityRisk !== "UNKNOWN");
      const executionQuality = knownCapacity.length ? Math.round(knownCapacity.reduce((sum, item) => sum + ({ LOW: 100, MEDIUM: 70, HIGH: 35, EXTREME: 0 }[item.capacityRisk] ?? 0), 0) / knownCapacity.length) : null;
      const scoreV3 = calculateWalletScoreV3({ verifiedTrades: metrics.verifiedTrades, winRate: metrics.winRate, medianReturn: metrics.medianReturn,
        realizedPnlUsd: metrics.realizedPnlUsd, maxDrawdown: drawdown.maxDrawdownPercent, rugExposureRate: rugRate,
        entryQuality: null, executionQuality, overallDataQuality: dataQualityV3 });
      const { error: scoreV3Error } = await this.db.from("wallet_scores").insert({ wallet_id: walletId, score: scoreV3.score, data_quality: scoreV3.dataQuality,
        scoring_version: scoreV3.version, components: { components: scoreV3.components, missing_components: scoreV3.missingComponents, policy_version: verification.policyVersion },
        calculated_at: now, data_cutoff_at: now, lifecycle: verification.eligibleStatus }); if (scoreV3Error) throw scoreV3Error;
      const { error: verificationError } = await this.db.from("wallet_verification_evaluations").insert({ wallet_id: walletId,
        policy_version: verification.policyVersion, evaluated_at: now, data_snapshot_cutoff: now, current_status: score.lifecycle,
        eligible_status: verification.eligibleStatus, requirements_passed: verification.passed, requirements_failed: verification.failed,
        evidence: { verifiedTrades: metrics.verifiedTrades, dataQualityV3, pricingCoverage, liquidityCoverage, riskCoverage, historyDays: Math.floor(historyDays), drawdownStatus: drawdown.status } });
      if (verificationError) throw verificationError;
      const { error: progressError } = await this.db.from("wallet_verification_progress").insert({ wallet_id: walletId, policy_version: progress.policyVersion,
        calculated_at: now, eligible_status: verification.eligibleStatus, verified_trades: metrics.verifiedTrades,
        required_verified_trades: WALLET_VERIFICATION_POLICY.minimumVerifiedTradeCycles, history_days: Math.floor(historyDays), required_history_days: WALLET_VERIFICATION_POLICY.minimumHistoryDays,
        liquidity_coverage: liquidityCoverage, required_liquidity_coverage: WALLET_VERIFICATION_POLICY.minimumLiquidityCoverage,
        risk_coverage: riskCoverage, required_risk_coverage: WALLET_VERIFICATION_POLICY.minimumRiskCoverage,
        data_quality: dataQualityV3, required_data_quality: WALLET_VERIFICATION_POLICY.minimumOverallDataQuality,
        pricing_coverage: pricingCoverage, required_pricing_coverage: WALLET_VERIFICATION_POLICY.minimumPricingCoverage,
        drawdown_available: drawdown.status === "available", blockers: verification.failed, progress }); if (progressError) throw progressError;
    }
    return saved;
  }

  async updateWalletCursor(walletId: string, signature: string) {
    const { error } = await this.db.rpc("update_wallet_sync_cursor", { target_wallet_id: walletId, new_signature: signature });
    if (error) throw error;
  }
  async updateWalletBackfillCursor(walletId: string, signature: string | null, complete: boolean) {
    const { error } = await this.db.rpc("update_wallet_backfill_cursor", { target_wallet_id: walletId, before_signature: signature, is_complete: complete });
    if (error) throw error;
  }

  async saveWalletDiscoveryCandidates(items: WalletDiscoveryCandidate[], provider: string) {
    if (items.length === 0) return 0;
    const { error } = await this.db.from("wallet_discovery_candidates").upsert(items.map((item) => ({
      chain: "solana", address: item.address, provider, status: "candidate", score: item.score,
      data_quality: item.dataQuality, observed_transactions: item.observedTransactions,
      successful_transactions: item.successfulTransactions, active_days: item.activeDays,
      source_addresses: item.sourceAddresses, reasons: item.reasons, risk_flags: item.riskFlags,
      last_observed_at: item.observedAt, updated_at: new Date().toISOString(),
    })), { onConflict: "chain,address", ignoreDuplicates: false });
    if (error) throw error;
    return items.length;
  }

  async startRun(kind: JobKind, provider: string) {
    const { data, error } = await this.db.from("ingestion_runs").insert({ job_kind: kind, provider, status: "running" }).select("id").single();
    if (error) throw error; return data.id as string;
  }

  async finishRun(id: string, recordsProcessed: number) {
    const { error } = await this.db.from("ingestion_runs").update({ status: "succeeded", records_processed: recordsProcessed, finished_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }

  async failRun(id: string, error: unknown) {
    const value = error instanceof Error ? error : new Error(String(error));
    await this.db.from("ingestion_runs").update({ status: "failed", error_code: "code" in value ? String(value.code) : null, error_message: value.message, finished_at: new Date().toISOString() }).eq("id", id);
  }

  async recordProviderError(runId: string, provider: string, error: unknown, context: Record<string, unknown> = {}) {
    const value = error instanceof Error ? error : new Error(String(error));
    await this.db.from("provider_errors").insert({ ingestion_run_id: runId, provider, error_code: "code" in value ? String(value.code) : "unknown", message: value.message, retryable: "retryable" in value ? Boolean(value.retryable) : false, http_status: "status" in value ? value.status : null, context });
  }
}
