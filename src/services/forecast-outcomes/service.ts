import type { SupabaseClient } from "@supabase/supabase-js";
import { horizonMs, outcomeMetrics, OUTCOME_POLICY_VERSION } from "@/domain/forecast";
import { schedulerCursorOffset } from "@/domain/forecast-scheduler";

export class ForecastOutcomeService {
  constructor(private db: SupabaseClient) {}

  async run(now = new Date().toISOString(), limit = 25, offset = 0) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const { data: forecasts, error } = await this.db.from("forecasts").select("*").lte("available_at", now).order("available_at").order("id").range(safeOffset, safeOffset + safeLimit - 1);
    if (error) throw error;
    let completed = 0, pending = 0, alreadyComplete = 0;
    for (const forecast of forecasts ?? []) {
      const existing = await this.db.from("forecast_outcomes").select("id").eq("forecast_id", forecast.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) { alreadyComplete++; continue; }
      const target = new Date(Date.parse(forecast.information_cutoff_at) + horizonMs(forecast.horizon)).toISOString();
      if (target > now) { pending++; continue; }
      const tolerance = Math.min(900_000, Math.max(60_000, horizonMs(forecast.horizon) * 0.1));
      const windowEnd = new Date(Date.parse(target) + tolerance).toISOString();
      const [{ data: entry, error: entryError }, { data: path, error: pathError }] = await Promise.all([
        this.db.from("crypto_market_observations").select("id,price_usd,observed_at,ingested_at").eq("asset_id", forecast.asset_id).lte("observed_at", forecast.information_cutoff_at).lte("ingested_at", forecast.available_at).order("observed_at", { ascending: false }).limit(1).maybeSingle(),
        this.db.from("crypto_market_observations").select("id,price_usd,observed_at,ingested_at").eq("asset_id", forecast.asset_id).gt("observed_at", forecast.information_cutoff_at).lte("observed_at", windowEnd).lte("ingested_at", now).order("observed_at"),
      ]);
      if (entryError) throw entryError;
      if (pathError) throw pathError;
      const usable = (path ?? []).filter((item: any) => Number(item.price_usd) > 0);
      const exit = usable.find((item: any) => item.observed_at >= target);
      if (!exit && now < windowEnd) { pending++; continue; }
      let row: any = { forecast_id: forecast.id, outcome_policy_version: OUTCOME_POLICY_VERSION, target_at: target, available_at: now, status: "INSUFFICIENT_DATA", reason: "NO_BOUNDED_POINT_IN_TIME_PRICE", evidence_refs: [] };
      if (entry && Number(entry.price_usd) > 0 && exit) {
        const metrics = outcomeMetrics({ expected: numeric(forecast.expected_return), lower: numeric(forecast.lower_bound), upper: numeric(forecast.upper_bound), entry: Number(entry.price_usd), exit: Number(exit.price_usd), path: [Number(entry.price_usd), ...usable.map((item: any) => Number(item.price_usd))] });
        row = { ...row, status: "AVAILABLE", reason: null, price_observed_at: exit.observed_at, actual_return: metrics.actualReturn, direction_correct: metrics.directionCorrect, absolute_error: metrics.absoluteError, range_hit: metrics.rangeHit, max_favorable_excursion: metrics.maxFavorableExcursion, max_adverse_excursion: metrics.maxAdverseExcursion, predicted_probability: numeric(forecast.probability_positive), actual_outcome: metrics.actualReturn >= 0, evidence_refs: [entry.id, ...usable.map((item: any) => item.id)] };
      }
      const saved = await this.db.from("forecast_outcomes").insert(row);
      if (saved.error?.code !== "23505" && saved.error) throw saved.error;
      completed++;
    }
    const scanned = forecasts?.length ?? 0;
    return { scanned, completed, pending, alreadyComplete, cursor: { offset: schedulerCursorOffset(safeOffset, scanned, safeLimit), limit: safeLimit } };
  }
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
}
