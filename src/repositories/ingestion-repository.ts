import { WalletRebuildService } from "@/services/wallet-rebuild/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockQuote } from "@/services/market-data/provider";
import type { NormalizedWalletTransaction, WalletDiscoveryCandidate } from "@/services/blockchain/provider";
import type { CryptoMarketPoint } from "@/services/crypto-market/provider";
import { liquiditySnapshotFromObservation, type LiquiditySnapshot } from "@/domain/historical-liquidity";
import type { TokenRiskAssessment } from "@/services/token-risk/provider";
import { chunks, ReadBudgetExceeded } from "./bounded-read";
import { walletEnrichmentInformation } from "@/domain/wallet-enrichment-information";

const WALLET_ENRICHMENT_VERSION = "wallet-enrichment-v2";

export type JobKind = "stock_quotes" | "wallet_transactions" | "wallet_discovery" | "pool_discovery" | "crypto_market" | "wallet_pnl" | "wallet_evidence" | "fast_flow" | "wallet_clustering" | "jackpot_collector" | "jackpot_outcomes" | "market_events" | "paper_eligibility" | "paper_execution" | "paper_exits" | "paper_valuation" | "performance" | "fx" | "qualification" | "data_gap_closure" | "simulation" | "historical_replay" | "forecast_catalyst" | "expert_knowledge" | "baseline_forecast" | "forecast_performance" | "forecast_scheduler" | "forecast_outcomes" | "specialist_agents" | "news_ingestion" | "catalyst_classification" | "consensus" | "agent_performance" | "market_regime" | "meta_agent" | "meta_readiness";

export class IngestionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async trackedWallets() {
    const { data, error } = await this.db.from("wallets").select("id,address,metadata").eq("is_tracked", true).order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; address: string; metadata: { last_signature?: string; backfill_before?: string; backfill_complete?: boolean; backfill_synced_at?: string } | null }>;
  }

  async walletDiscoverySeeds(configuredSeeds: string[], limit = 10) {
    const bounded = Math.max(1, Math.min(limit, 25));
    const unique = new Set(configuredSeeds.map((value) => value.trim()).filter(Boolean));
    const { data: tracked, error: trackedError } = await this.db
      .from("wallets")
      .select("address")
      .eq("is_tracked", true)
      .order("first_seen_at", { ascending: true })
      .limit(bounded);
    if (trackedError) throw trackedError;
    for (const row of tracked ?? []) unique.add(row.address);
    const { data: candidates, error: candidateError } = await this.db
      .from("wallet_discovery_candidates")
      .select("address")
      .in("status", ["tracked", "reviewing", "verified"])
      .order("score", { ascending: false })
      .order("data_quality", { ascending: false })
      .limit(bounded);
    if (candidateError) throw candidateError;
    for (const row of candidates ?? []) unique.add(row.address);
    return [...unique].slice(0, bounded);
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

  async cryptoTokens(limit = 250) {
    const ids = await this.claimSubjects("crypto-market", "crypto", Math.min(250, limit));
    return this.tokensForAssets(ids);
  }

  private async claimSubjects(work: string, kind: "wallet" | "crypto" | "wallet_asset", limit: number) {
    const { data, error } = await this.db.rpc("claim_ingestion_subjects", { target_work: work, subject_kind: kind, batch_limit: limit });
    if (error) throw error;
    return (data ?? []).map((row: { subject_id: string }) => row.subject_id) as string[];
  }

  private async tokensForAssets(ids: string[]) {
    const result: Array<{ asset_id: string; mint_address: string }> = [];
    for (const batch of chunks([...new Set(ids)])) {
      const { data, error } = await this.db.from("crypto_tokens").select("asset_id,mint_address").in("asset_id", batch);
      if (error) throw error;
      result.push(...(data ?? []));
    }
    return result;
  }

  async walletEvidenceTargets(limit = 10) {
    const ids = await this.claimSubjects("wallet-evidence", "wallet_asset", Math.max(1, Math.min(limit, 100)));
    const tokens = await this.tokensForAssets(ids);
    const targets: Array<{ assetId: string; mintAddress: string; from: string; to: string }> = [];
    for (const token of tokens) {
      const { data, error } = await this.db.rpc("wallet_evidence_missing_window", { target_asset: token.asset_id });
      if (error) throw error;
      const at = data?.[0]?.occurred_at as string | undefined;
      if (at) targets.push({ assetId: token.asset_id, mintAddress: token.mint_address, from: at, to: at });
    }
    return targets;
  }
  async hasLiquidityEvidence(assetId: string, timestamp: string) {
    // Use the queue's exact PIT predicate: a later observation or later-known
    // historical value cannot count as evidence available at the trade time.
    const { data, error } = await this.db.rpc("wallet_has_liquidity_evidence_at", {
      target_asset: assetId, target_at: timestamp,
    });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("WALLET_LIQUIDITY_COVERAGE_INVALID_RESPONSE");
    return data;
  }
  async hasFreshRiskEvidence(assetId: string, provider: string, since: string) { const { count, error } = await this.db.from("token_risk_assessments").select("id", { count: "exact", head: true }).eq("asset_id", assetId).eq("provider", provider).gte("assessed_at", since); if (error) throw error; return (count ?? 0) > 0; }
  async saveLiquiditySnapshots(snapshots: LiquiditySnapshot[]) { if (!snapshots.length) return 0; const now = new Date().toISOString(); const { error } = await this.db.from("crypto_liquidity_snapshots").upsert(snapshots.map((item) => ({ snapshot_key: `${item.assetId}:${item.provider}:${item.effectiveAt}:${item.poolAddress ?? "token_aggregate"}`, asset_id: item.assetId, pool_address: item.poolAddress, liquidity_usd: item.liquidityUsd, provider: item.provider, selection_version: "latest-effective-highest-liquidity-v1", observed_at: now, effective_at: item.effectiveAt, information_available_at: item.informationAvailableAt, data_quality: item.quality, raw_payload: { scope: item.poolAddress ? "pool" : "token_aggregate" } })), { onConflict: "snapshot_key", ignoreDuplicates: true }); if (error) throw error; return snapshots.length; }
  async saveTokenRiskAssessment(assetId: string, assessment: TokenRiskAssessment) { const { data, error } = await this.db.from("token_risk_assessments").upsert({ asset_id: assetId, provider: assessment.provider, risk_version: assessment.riskVersion, assessed_at: assessment.assessedAt, information_cutoff_at: assessment.informationCutoffAt, information_available_at: assessment.informationAvailableAt, rug_risk_score: assessment.rugRiskScore, rug_status: assessment.rugStatus, risk_components: assessment.riskComponents, data_quality: assessment.dataQuality }, { onConflict: "asset_id,provider,risk_version,information_cutoff_at", ignoreDuplicates: false }).select("id").single(); if (error) throw error;
    const components = (assessment.riskComponents as { components?: Array<{ key: string; value: unknown; status: string; observedAt: string; informationAvailableAt: string; source: string }> }).components ?? [];
    if (components.length) { const { error: componentError } = await this.db.from("token_risk_components").upsert(components.map((item) => ({ assessment_id: data.id, component_key: item.key, component_value: item.value, component_status: item.status, observed_at: item.observedAt, information_available_at: item.informationAvailableAt, source: item.source })), { onConflict: "assessment_id,component_key", ignoreDuplicates: false }); if (componentError) throw componentError; }
    return 1;
  }

  async saveCryptoMarketPoints(points: CryptoMarketPoint[]) {
    const tokens: Array<{ asset_id: string; mint_address: string }> = [];
    for (const mints of chunks([...new Set(points.map((point) => point.mintAddress))])) {
      const { data, error } = await this.db.from("crypto_tokens").select("asset_id,mint_address").in("mint_address", mints);
      if (error) throw error;
      tokens.push(...(data ?? []));
    }
    const assetByMint = new Map(tokens.map((item) => [item.mint_address, item.asset_id])); let saved = 0;
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

  async walletTransactionsForEnrichment(provider: string, limit = 10) {
    const { data, error } = await this.db.rpc("claim_wallet_enrichment_targets", {
      target_provider: provider, target_version: WALLET_ENRICHMENT_VERSION,
      batch_limit: Math.max(1, Math.min(50, limit)), input_cutoff: new Date().toISOString(),
    });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ ...row, id: row.transaction_id, mintAddress: row.mint_address }));
  }

  async enrichedTransactionIds(provider: string) {
    const { data, error } = await this.db.from("wallet_transaction_enrichments").select("wallet_transaction_id").eq("provider", provider).eq("enrichment_version", WALLET_ENRICHMENT_VERSION);
    if (error) throw error; return new Set((data ?? []).map((item) => item.wallet_transaction_id as string));
  }

  async saveTransactionEnrichment(input: { transactionId: string; provider: string; tokenPoint: CryptoMarketPoint; solPoint: CryptoMarketPoint; quantity: number; rawFeeLamports: number | null }) {
    const tokenPrice = input.tokenPoint.priceUsd; const solPrice = input.solPoint.priceUsd;
    const feeUsd = input.rawFeeLamports === null || solPrice === null ? null : input.rawFeeLamports / 1e9 * solPrice;
    const pricingCompleteness = tokenPrice !== null && solPrice !== null ? 100 : tokenPrice !== null ? 50 : 0;
    const executionCompleteness = feeUsd === null ? 0 : 100;
    const information = walletEnrichmentInformation(input.tokenPoint.poolAddress);
    const informationCompleteness: number = information.completeness;
    const status = pricingCompleteness === 100 && executionCompleteness === 100 && informationCompleteness === 100 ? "complete" : pricingCompleteness > 0 ? "partial" : "incomplete";
    const { error } = await this.db.from("wallet_transaction_enrichments").upsert({ wallet_transaction_id: input.transactionId, provider: input.provider,
      enrichment_version: WALLET_ENRICHMENT_VERSION, status, token_price_usd: tokenPrice, sol_price_usd: solPrice,
      estimated_value_usd: tokenPrice === null ? null : input.quantity * tokenPrice, fee_usd: feeUsd, priority_fee_usd: null,
      liquidity_usd: input.tokenPoint.liquidityUsd, market_cap_usd: input.tokenPoint.marketCapUsd,
      price_timestamp: input.tokenPoint.providerTimestamp, known_at: new Date().toISOString(), pricing_completeness: pricingCompleteness,
      execution_completeness: executionCompleteness, information_completeness: informationCompleteness,
      priority_fee_status: "unavailable_from_current_raw_payload", raw_payload: { token: input.tokenPoint.rawPayload, sol: input.solPoint.rawPayload, informationContract: information } },
    { onConflict: "wallet_transaction_id,provider,enrichment_version", ignoreDuplicates: true });
    if (error) throw error; return { status };
  }

  async rebuildWalletPnl(provider: string) {
    const active = await this.db.from("wallet_rebuild_jobs").select("wallet_id").eq("status", "ACTIVE").eq("provider", provider).order("updated_at").limit(2);
    if (active.error) throw active.error;
    const pending = (active.data ?? []).map(row => row.wallet_id as string);
    const fresh = await this.claimSubjects(`wallet-rebuild:${provider}`, "wallet", Math.max(1, 3 - pending.length));
    const walletIds = [...new Set([...pending, ...fresh])].slice(0, 3);
    const blocked: Array<{ walletId: string; reason: string }> = [];
    const pendingWallets: Array<{ walletId: string; jobId: string; completedAssets: number; totalAssets: number }> = [];
    let cycles = 0, walletsProcessed = 0;
    for (const walletId of walletIds) {
      try {
        const result = await new WalletRebuildService(this.db).run(walletId, provider);
        cycles += result.cycles;
        if (result.completed) walletsProcessed++;
        else pendingWallets.push({ walletId, jobId: result.jobId, completedAssets: result.completedAssets, totalAssets: result.totalAssets });
      } catch (error) {
        if (!(error instanceof ReadBudgetExceeded)) throw error;
        blocked.push({ walletId, reason: error.message });
      }
    }
    return { cycles, walletsProcessed, blocked, pendingWallets,
      informationBlockers: ["VERIFIED_EXECUTION_CONTEXT_UNAVAILABLE"] };
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

  async failRun(id: string, error: unknown, recordsProcessed?: number) {
    if (recordsProcessed !== undefined && (!Number.isSafeInteger(recordsProcessed) || recordsProcessed < 0)) {
      throw new Error("INVALID_INGESTION_RECORD_COUNT");
    }
    const value = error instanceof Error ? error : new Error(String(error));
    const saved = await this.db.from("ingestion_runs").update({
      status: "failed", error_code: "code" in value ? String(value.code) : null,
      error_message: value.message, finished_at: new Date().toISOString(),
      ...(recordsProcessed === undefined ? {} : { records_processed: recordsProcessed }),
    }).eq("id", id);
    if (saved.error) throw saved.error;
  }

  async recordProviderError(runId: string, provider: string, error: unknown, context: Record<string, unknown> = {}) {
    const value = error instanceof Error ? error : new Error(String(error));
    await this.db.from("provider_errors").insert({ ingestion_run_id: runId, provider, error_code: "code" in value ? String(value.code) : "unknown", message: value.message, retryable: "retryable" in value ? Boolean(value.retryable) : false, http_status: "status" in value ? value.status : null, context });
  }
}
