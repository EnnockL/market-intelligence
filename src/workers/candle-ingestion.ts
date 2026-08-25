import type { SupabaseClient } from "@supabase/supabase-js";
import { HistoricalCandleService } from "@/services/candles/service";
import { FinnhubCandleProvider } from "@/services/candles/finnhub-candle-provider";
import { GeckoTerminalCandleProvider } from "@/services/candles/geckoterminal-candle-provider";
import { timeframeSeconds, type CandleRequest, type HistoricalCandleProvider } from "@/services/candles/provider";

export async function runCandleIngestion(db: SupabaseClient, finnhubKey: string, now = new Date().toISOString(), sourceLimit = 3) {
  const { data: sources, error } = await db.from("candle_sources").select("*").eq("enabled", true).neq("status", "PAUSED").order("last_successful_sync", { ascending: true, nullsFirst: true }).limit(sourceLimit);
  if (error) throw error;
  const results = [];
  for (const source of sources ?? []) {
    await db.from("candle_sources").update({ status: "SYNCING", updated_at: now }).eq("id", source.id);
    try {
      const provider: HistoricalCandleProvider = source.provider === "geckoterminal-ohlcv" ? new GeckoTerminalCandleProvider() : new FinnhubCandleProvider(finnhubKey);
      const overlap = timeframeSeconds(source.timeframe) * 1000;
      const incrementalStart = source.cursor
        ? source.backfill_starts_at
        : source.last_successful_sync
          ? new Date(Math.max(Date.parse(source.backfill_starts_at), Date.parse(source.last_successful_sync) - overlap)).toISOString()
          : source.backfill_starts_at;
      const request: CandleRequest = { assetId: source.asset_id, instrumentKind: source.instrument_kind, providerSymbol: source.provider_symbol, timeframe: source.timeframe, startsAt: incrementalStart, endsAt: now, cursor: source.cursor, limit: 500, tokenSide: source.token_side ?? undefined };
      const result = await new HistoricalCandleService(db, provider).sync(request, 3);
      await db.from("candle_sources").update({ cursor: result.nextCursor, last_successful_sync: result.status === "COMPLETED" ? now : source.last_successful_sync, last_error: null, status: result.status === "COMPLETED" ? "HEALTHY" : "PENDING", consecutive_failures: 0, updated_at: now }).eq("id", source.id);
      results.push({ sourceKey: source.source_key, success: true, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : JSON.stringify(cause), failures = Number(source.consecutive_failures ?? 0) + 1;
      await db.from("candle_sources").update({ status: failures >= 3 ? "FAILED" : "DEGRADED", consecutive_failures: failures, last_error: message, updated_at: now }).eq("id", source.id);
      results.push({ sourceKey: source.source_key, success: false, error: message });
    }
  }
  return { sources: results.length, fetched: results.reduce((sum, item) => sum + ("fetched" in item ? Number(item.fetched) : 0), 0), results };
}
