import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockQuote } from "@/services/market-data/provider";
import type { NormalizedWalletTransaction, WalletDiscoveryCandidate } from "@/services/blockchain/provider";
import type { CryptoMarketPoint } from "@/services/crypto-market/provider";
import { calculateWalletPnlMetrics, reconstructTradeCycles, POSITION_ENGINE_VERSION, type EnrichedWalletTrade, type TradeCycle } from "@/domain/wallet-pnl";
import { calculateWalletScoreV2 } from "@/domain/wallet-scoring";
import { calculateRugExposure, type TokenRiskClassification } from "@/domain/token-risk";

const WALLET_ENRICHMENT_VERSION = "wallet-enrichment-v2";

export type JobKind = "stock_quotes" | "wallet_transactions" | "wallet_discovery" | "crypto_market" | "wallet_pnl";

export class IngestionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async trackedWallets() {
    const { data, error } = await this.db.from("wallets").select("id,address,metadata").eq("is_tracked", true);
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; address: string; metadata: { last_signature?: string } | null }>;
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

  async saveCryptoMarketPoints(points: CryptoMarketPoint[]) {
    const tokens = await this.cryptoTokens(); const assetByMint = new Map(tokens.map((item) => [item.mint_address, item.asset_id])); let saved = 0;
    for (const point of points) { const assetId = assetByMint.get(point.mintAddress); if (!assetId) continue;
      const { error } = await this.db.from("crypto_market_observations").upsert({ asset_id: assetId, provider: point.provider, observed_at: point.observedAt,
        provider_timestamp: point.providerTimestamp, price_usd: point.priceUsd, market_cap_usd: point.marketCapUsd,
        circulating_supply: point.circulatingSupply, liquidity_usd: point.liquidityUsd, volume_24h_usd: point.volume24hUsd,
        pool_address: point.poolAddress, confidence: point.confidence, completeness: point.completeness, raw_payload: point.rawPayload },
      { onConflict: "asset_id,provider,observed_at", ignoreDuplicates: true });
      if (error) throw error; saved += 1;
    } return saved;
  }

  async walletTransactionsForEnrichment() {
    const { data: transactions, error } = await this.db.from("wallet_transactions").select("id,wallet_id,asset_id,transaction_hash,instruction_index,side,quantity,occurred_at,raw_payload").not("asset_id", "is", null).in("side", ["buy", "sell"]).order("occurred_at", { ascending: true });
    if (error) throw error; const tokens = await this.cryptoTokens(); const mintByAsset = new Map(tokens.map((item) => [item.asset_id, item.mint_address]));
    return (transactions ?? []).flatMap((item) => { const mintAddress = mintByAsset.get(item.asset_id); return mintAddress ? [{ ...item, mintAddress }] : []; });
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
    const groups = new Map<string, typeof transactions>();
    for (const tx of transactions) { const key = `${tx.wallet_id}:${tx.asset_id}`; const values = groups.get(key) ?? []; values.push(tx); groups.set(key, values); }
    const cyclesByWallet = new Map<string, TradeCycle[]>();
    const riskCyclesByWallet = new Map<string, Array<{ assetId: string; cycle: TradeCycle }>>(); let saved = 0;
    for (const [key, values] of groups) { const [walletId, assetId] = key.split(":");
      const events: EnrichedWalletTrade[] = values.map((tx) => { const enrichment = enrichmentByTx.get(tx.id); return { id: tx.id, signature: tx.transaction_hash,
        instructionIndex: tx.instruction_index, token: tx.mintAddress, side: tx.side as "buy" | "sell", quantity: Number(tx.quantity), occurredAt: tx.occurred_at,
        tokenPriceUsd: enrichment?.token_price_usd === null || enrichment?.token_price_usd === undefined ? null : Number(enrichment.token_price_usd),
        feeUsd: enrichment?.fee_usd === null || enrichment?.fee_usd === undefined ? null : Number(enrichment.fee_usd),
        pricingComplete: enrichment?.pricing_completeness === 100, executionComplete: enrichment?.execution_completeness === 100,
        informationCompleteness: enrichment?.information_completeness ?? 0 }; });
      const cycles = reconstructTradeCycles(events); await this.db.from("wallet_trade_cycles").delete().eq("wallet_id", walletId).eq("asset_id", assetId).eq("engine_version", POSITION_ENGINE_VERSION);
      if (cycles.length) { const { error: cycleError } = await this.db.from("wallet_trade_cycles").insert(cycles.map((cycle) => ({ wallet_id: walletId, asset_id: assetId,
        cycle_number: cycle.cycleNumber, engine_version: cycle.engineVersion, status: cycle.status, quantity: cycle.quantity, invested_usd: cycle.investedUsd,
        cost_basis_usd: cycle.costBasisUsd, average_entry_usd: cycle.averageEntryUsd, proceeds_usd: cycle.proceedsUsd, realized_pnl_usd: cycle.realizedPnlUsd,
        unrealized_pnl_usd: cycle.unrealizedPnlUsd, return_percent: cycle.returnPercent, first_entry_at: cycle.firstEntryAt, final_exit_at: cycle.finalExitAt,
        holding_seconds: cycle.holdingSeconds, pricing_completeness: cycle.pricingCompleteness, transaction_completeness: cycle.transactionCompleteness,
        execution_completeness: cycle.executionCompleteness, information_completeness: cycle.informationCompleteness,
        data_quality: cycle.dataQuality, transaction_ids: cycle.transactionIds }))); if (cycleError) throw cycleError; }
      saved += cycles.length; const walletCycles = cyclesByWallet.get(walletId) ?? []; walletCycles.push(...cycles); cyclesByWallet.set(walletId, walletCycles);
      const walletRiskCycles = riskCyclesByWallet.get(walletId) ?? []; walletRiskCycles.push(...cycles.map((item) => ({ assetId, cycle: item }))); riskCyclesByWallet.set(walletId, walletRiskCycles);
    }
    const now = new Date().toISOString();
    const { data: riskRows, error: riskError } = await this.db.from("token_risk_observations").select("asset_id,classification,known_at").lte("known_at", now).order("known_at", { ascending: false });
    if (riskError) throw riskError; const latestRisk = new Map<string, TokenRiskClassification>();
    for (const row of riskRows ?? []) if (!latestRisk.has(row.asset_id)) latestRisk.set(row.asset_id, row.classification as TokenRiskClassification);
    for (const [walletId, cycles] of cyclesByWallet) { const metrics = calculateWalletPnlMetrics(cycles); const quality = cycles.length ? Math.round(cycles.reduce((sum, cycle) => sum + cycle.dataQuality, 0) / cycles.length) : 0;
      const closedRiskCycles = (riskCyclesByWallet.get(walletId) ?? []).filter((item) => item.cycle.finalExitAt !== null);
      const risk = calculateRugExposure(closedRiskCycles.map((item) => ({ assetId: item.assetId, classification: latestRisk.get(item.assetId) ?? null })));
      const { error: metricError } = await this.db.from("wallet_metric_snapshots").insert({ wallet_id: walletId, engine_version: POSITION_ENGINE_VERSION,
        scoring_version: "wallet-metrics-v2-preparation", calculated_at: now, information_available_through: now, closed_trades: metrics.closedTrades,
        verified_trades: metrics.verifiedTrades, wins: metrics.wins, losses: metrics.losses, win_rate: metrics.winRate, median_return: metrics.medianReturn,
        mean_return: metrics.meanReturn, realized_pnl_usd: metrics.realizedPnlUsd, best_trade_percent: metrics.bestTradePercent,
        worst_trade_percent: metrics.worstTradePercent, median_holding_seconds: metrics.medianHoldingSeconds, data_quality: quality,
        max_drawdown: metrics.maxDrawdown, rug_exposure_rate: risk.rugExposureRate, rug_assessed_trades: risk.assessedTrades,
        risk_data_quality: risk.coverage, metrics: { ...metrics, rugExposure: risk } }); if (metricError) throw metricError;
      const score = calculateWalletScoreV2({ closedTrades: metrics.closedTrades, verifiedTrades: metrics.verifiedTrades, winRate: metrics.winRate,
        medianReturn: metrics.medianReturn, realizedPnlUsd: metrics.realizedPnlUsd, maxDrawdown: metrics.maxDrawdown, rugExposureRate: risk.rugExposureRate,
        medianHoldingSeconds: metrics.medianHoldingSeconds, overallDataQuality: quality });
      const { error: scoreError } = await this.db.from("wallet_scores").insert({ wallet_id: walletId, score: score.score, data_quality: score.dataQuality,
        scoring_version: score.version, components: { components: score.components, missing_components: score.missingComponents, lifecycle: score.lifecycle },
        calculated_at: now, data_cutoff_at: now, lifecycle: score.lifecycle }); if (scoreError) throw scoreError; }
    return saved;
  }

  async updateWalletCursor(walletId: string, signature: string) {
    const { error } = await this.db.rpc("update_wallet_sync_cursor", { target_wallet_id: walletId, new_signature: signature });
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
