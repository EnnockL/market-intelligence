import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockQuote } from "@/services/market-data/provider";
import type { NormalizedWalletTransaction, WalletDiscoveryCandidate } from "@/services/blockchain/provider";

export type JobKind = "stock_quotes" | "wallet_transactions" | "wallet_discovery";

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
        const { data } = await this.db.from("crypto_tokens").select("asset_id").eq("mint_address", item.mintAddress).maybeSingle();
        assetId = data?.asset_id ?? null;
      }
      const { error } = await this.db.from("wallet_transactions").upsert({ wallet_id: walletId, asset_id: assetId, transaction_hash: item.signature, instruction_index: item.instructionIndex, side: item.side, quantity: item.quantity, block_number: item.slot, occurred_at: item.occurredAt, raw_payload: item.rawPayload }, { onConflict: "transaction_hash,instruction_index,wallet_id", ignoreDuplicates: true });
      if (error) throw error;
      inserted += 1;
    }
    return inserted;
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
