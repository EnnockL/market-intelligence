import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandleRequest, HistoricalCandleProvider } from "./provider";
import { stableCandleKey } from "./provider";

export class HistoricalCandleService {
  constructor(private db: SupabaseClient, private provider: HistoricalCandleProvider) {}
  async sync(request: CandleRequest, maxPages = 5) {
    let cursor = request.cursor ?? null, inserted = 0, fetched = 0, pages = 0;
    for (let page = 0; page < Math.max(1, Math.min(20, maxPages)); page++) {
      const batch = await this.provider.getCandles({ ...request, cursor }); fetched += batch.candles.length;
      pages += 1;
      if (batch.candles.length) {
        const saved = await this.db.from("market_candles").upsert(batch.candles.map(candle => ({ candle_key: stableCandleKey(candle), asset_id: candle.assetId, provider: candle.provider, timeframe: candle.timeframe, opened_at: candle.openedAt, closed_at: candle.closedAt, observed_at: candle.observedAt, available_at: candle.availableAt, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, data_quality: candle.dataQuality, raw_payload: candle.rawPayload })), { onConflict: "candle_key", ignoreDuplicates: true }).select("id");
        if (saved.error) throw saved.error; inserted += saved.data?.length ?? 0;
      }
      if (!batch.nextCursor || batch.nextCursor === cursor) { cursor = null; break; }
      cursor = batch.nextCursor;
    }
    return { provider: this.provider.name, fetched, inserted, pages, nextCursor: cursor, status: cursor ? "PARTIAL" : "COMPLETED" };
  }
}
