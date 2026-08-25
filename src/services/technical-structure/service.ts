import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { marketTimeContext } from "@/domain/market-time";
import { analyzeTechnicalStructure, type MarketCandle } from "@/domain/technical-structure";

export class TechnicalStructureService {
  constructor(private db: SupabaseClient) {}
  async run(assetId: string, timeframe: string, cutoffAt: string, exchangeTimeZone: string) {
    const candles = await this.loadCandles(assetId, timeframe, cutoffAt);
    const structure = analyzeTechnicalStructure({ assetId, timeframe, cutoffAt, exchangeTimeZone, candles });
    const snapshotKey = deterministicDigest({ assetId, timeframe, cutoffAt, version: structure.version, analysisHash: structure.analysisHash });
    const saved = await this.db.from("technical_structure_snapshots").insert({ snapshot_key: snapshotKey, version: structure.version, asset_id: assetId, timeframe, analysis_cutoff_at: cutoffAt, available_at: cutoffAt, status: structure.status, trend_state: structure.trendState, structure, evidence_refs: structure.evidenceRefs, data_quality: structure.dataQuality, analysis_hash: structure.analysisHash }).select("id").single();
    if (saved.error?.code !== "23505" && saved.error) throw saved.error;
    const context = marketTimeContext(cutoffAt, exchangeTimeZone);
    const contextHash = deterministicDigest(context), contextKey = deterministicDigest({ assetId, contextHash });
    const timeSaved = await this.db.from("market_time_contexts").insert({ context_key: contextKey, version: context.version, asset_id: assetId, cutoff_at: cutoffAt, available_at: cutoffAt, exchange_timezone: exchangeTimeZone, weekday: context.weekday, utc_time: context.utcTime, local_exchange_time: context.localExchangeTime, market_session: context.marketSession, session_phase: context.sessionPhase, minutes_since_open: context.minutesSinceOpen, minutes_to_close: context.minutesToClose, flags: { monthEnd: context.monthEnd, quarterEnd: context.quarterEnd, optionsExpiry: context.optionsExpiry, earningsWindow: context.earningsWindow, macroEventWindow: context.macroEventWindow }, context_hash: contextHash });
    if (timeSaved.error?.code !== "23505" && timeSaved.error) throw timeSaved.error;
    return { structure, context, reused: saved.error?.code === "23505" };
  }
  async loadCandles(assetId: string, timeframe: string, cutoffAt: string): Promise<MarketCandle[]> {
    const pageSize = 1_000;
    const rows: any[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.db.from("market_candles")
        .select("id,asset_id,timeframe,opened_at,closed_at,available_at,open,high,low,close,volume")
        .eq("asset_id", assetId)
        .eq("timeframe", timeframe)
        .lte("closed_at", cutoffAt)
        .lte("available_at", cutoffAt)
        .order("opened_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
    return rows.map((item: any) => ({ id: item.id, assetId: item.asset_id, timeframe: item.timeframe, openedAt: item.opened_at, closedAt: item.closed_at, availableAt: item.available_at, open: Number(item.open), high: Number(item.high), low: Number(item.low), close: Number(item.close), volume: item.volume === null ? null : Number(item.volume) }));
  }
}
