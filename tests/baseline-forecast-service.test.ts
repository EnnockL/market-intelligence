import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { BASELINE_FORECAST_VERSION, buildHistoricalBaseline } from "@/domain/baseline-forecast";
import { BaselineForecastService, featureAt, historicalExamples } from "@/services/baseline-forecast/service";
import { BASELINE_INPUT_POLICY, loadBaselineObservations } from "@/services/baseline-forecast/observations";
import { loadBaselineTargets } from "@/services/baseline-forecast/targets";

const assetId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const at = (index: number) => new Date(Date.parse("2026-08-03T13:30:00Z") + index * 300_000).toISOString();
const candle = (index: number, extra: Record<string, unknown> = {}) => ({
  id: `candle-${String(index).padStart(5, '0')}`, asset_id: assetId, timeframe: "5m", closed_at: at(index), available_at: at(index), close: 100 + index * 0.01, volume: 1_000, data_quality: 95, ...extra,
});
const target = (cutoff: string, extra: Record<string, unknown> = {}) => ({
  id: sourceId, asset_id: assetId, asset_kind: "stock", catalyst_id: null, opportunity_id: null, candidate_id: null,
  information_cutoff_at: cutoff, available_at: cutoff, horizon: "5m", forecast_version: "forecast-infrastructure-v1", ...extra,
});

describe("typed baseline observations", () => {
  it("pages beyond the 1,000-row server cap and retains the current same-asset stock bar", async () => {
    const data = Array.from({ length: 1_105 }, (_, i) => candle(i));
    data.push(candle(1_104, { id: "foreign", asset_id: "another-asset" }));
    data.push(candle(1_104, { id: "wrong-timeframe", timeframe: "1h" }));
    const mock = database({ market_candles: data });
    const result = await loadBaselineObservations(mock.db, assetId, "STOCK", at(1_104));
    expect(result).toHaveLength(1_105);
    expect(result[0].id).toBe("candle-00000");
    expect(result.at(-1)?.id).toBe("candle-01104");
    expect(result.every(row => row.assetId === assetId && row.sourceTable === "market_candles")).toBe(true);
    expect(mock.calls.filter(call => call.table === "market_candles").map(call => call.range)).toEqual([[0, 999], [1_000, 1_999]]);
    expect(mock.calls.some(call => call.table === "crypto_market_observations")).toBe(false);
  });

  it("excludes future bars, late availability and data outside the bounded history", async () => {
    const mock = database({ market_candles: [candle(0), candle(1), candle(2, { available_at: at(10) }), candle(4), candle(-10_000)] });
    const result = await loadBaselineObservations(mock.db, assetId, "STOCK", at(3));
    expect(result.map(row => row.id)).toEqual(["candle-00000", "candle-00001"]);
    expect(result.every(row => row.availableAt <= at(3))).toBe(true);
  });

  it("uses only the correct crypto asset and requires ingestion before cutoff", async () => {
    const crypto = (id: string, timestamp: string, extra = {}) => ({ id, asset_id: assetId, observed_at: timestamp, ingested_at: timestamp, price_usd: 2, volume_24h_usd: 500, liquidity_usd: 3_000, market_cap_usd: null, confidence: 80, ...extra });
    const mock = database({ crypto_market_observations: [crypto("yes", at(1)), crypto("late", at(1), { ingested_at: at(10) }), crypto("foreign", at(1), { asset_id: "other" })] });
    const rows = await loadBaselineObservations(mock.db, assetId, "CRYPTO", at(3));
    expect(rows.map(row => row.id)).toEqual(["yes"]);
    expect(rows[0]).toMatchObject({ assetClass: "CRYPTO", liquidityUsd: 3_000, price: 2 });
  });

  it("caps work to the newest policy window instead of rereading unbounded history", async () => {
    // More observations than the cap inside 30 days, with distinct second stamps.
    const rows = Array.from({ length: BASELINE_INPUT_POLICY.maxRows + 25 }, (_, i) => candle(i, { closed_at: new Date(Date.parse(at(0)) + i * 1_000).toISOString(), available_at: at(100) }));
    const mock = database({ market_candles: rows });
    const result = await loadBaselineObservations(mock.db, assetId, "STOCK", at(100));
    expect(result).toHaveLength(BASELINE_INPUT_POLICY.maxRows);
    expect(result[0].id).toBe("candle-00025");
    expect(result.at(-1)?.id).toBe("candle-10024");
    expect(mock.calls).toHaveLength(10);
  });

  it("does not manufacture volume, pool liquidity, or five-minute momentum over a market closure", async () => {
    const mock = database({ market_candles: [candle(0), candle(1, { volume: null }), candle(300)] });
    const rows = await loadBaselineObservations(mock.db, assetId, "STOCK", at(300));
    expect(featureAt(rows, rows[1], "STOCK")).toMatchObject({ volumeMultiple5m: null, liquidityUsd: null });
    expect(featureAt(rows, rows[2], "STOCK").priceMomentum5m).toBeNull();
    expect(buildHistoricalBaseline(featureAt(rows, rows[1], "STOCK"), [], "5m", at(300)).reason).toBe("TARGET_FEATURES_INCOMPLETE");
  });

  it("uses typed buckets so stock cohorts never borrow crypto examples", async () => {
    const mock = database({ market_candles: Array.from({ length: 50 }, (_, i) => candle(i)) });
    const rows = await loadBaselineObservations(mock.db, assetId, "STOCK", at(49));
    const examples = historicalExamples(rows, "5m", at(49));
    const features = featureAt(rows, rows.at(-1)!, "STOCK");
    expect(features.liquidityUsd).toBeNull();
    expect(buildHistoricalBaseline(features, examples, "5m", at(49)).status).toBe("AVAILABLE");
    expect(buildHistoricalBaseline(features, examples.map(example => ({ ...example, features: { ...example.features, assetClass: "CRYPTO", liquidityUsd: 30_000 } })), "5m", at(49)).sampleSize).toBe(0);
    expect(examples.every(example => example.outcomeAt <= at(49) && example.availableAt <= at(49))).toBe(true);
  });
});

describe("baseline v2 persistence and queue identity", () => {
  it("reserves capacity for current targets and backfill even with a large old queue", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => target(at(i), { id: `old-${i}` }));
    rows.push(...Array.from({ length: 30 }, (_, i) => target(at(500), { id: `current-${i}` })));
    rows.push(target(at(510), { id: "future" }), target(at(500), { id: "late", available_at: at(510) }));
    const mock = database({ baseline_forecast_pending_targets_v2: rows });
    const selected = await loadBaselineTargets(mock.db, at(500));
    expect(selected).toHaveLength(25);
    expect(selected.filter(row => row.id.startsWith("current-"))).toHaveLength(20);
    expect(selected.filter(row => row.id.startsWith("old-"))).toHaveLength(5);
    expect(selected.some(row => ["future", "late"].includes(row.id))).toBe(false);
    expect(await loadBaselineTargets(database({ baseline_forecast_pending_targets_v2: rows.slice(0, 100) }).db, at(500))).toHaveLength(25);
    expect(await loadBaselineTargets(database({ baseline_forecast_pending_targets_v2: rows.slice(300, 330) }).db, at(500))).toHaveLength(25);
  });

  it("keeps failed bundles pending, processes other targets and reports a failed run with partial counts", async () => {
    const failedId = "00000000-0000-4000-8000-000000000003";
    const mock = database({ baseline_forecast_pending_targets_v2: [target(at(1), { id: failedId }), target(at(2))] }, failedId);
    await expect(new BaselineForecastService(mock.db).run(at(3))).rejects.toThrow("BASELINE_TARGET_FAILURE: 1 of 2");
    expect(mock.tables.baseline_forecast_runs[0]).toMatchObject({ status: "FAILED", forecasts_evaluated: 1 });
    expect(mock.tables.forecasts).toHaveLength(1);
    expect(mock.tables.baseline_feature_snapshots).toHaveLength(1);
    expect(mock.tables.event_outbox).toHaveLength(1);
    expect((await loadBaselineTargets(mock.db, at(3))).map(row => row.id)).toEqual([failedId]);
  });
  it("leaves v1 untouched, persists stock source references and drains the source only for v2", async () => {
    const old = { id: "v1-record", forecast_key: "old-key", forecast_version: "historical-cohort-baseline-v1", expected_return: null, agent_inputs: { sourceForecastId: sourceId } };
    const mock = database({ forecasts: [old], baseline_forecast_pending_targets_v2: [target(at(49))], market_candles: Array.from({ length: 50 }, (_, i) => candle(i)) });
    const service = new BaselineForecastService(mock.db);
    expect(await service.run(at(49))).toMatchObject({ evaluated: 1, available: 1 });
    const newRow = mock.tables.forecasts.find(row => row.forecast_version === BASELINE_FORECAST_VERSION)!;
    expect(newRow).toMatchObject({ status: "AVAILABLE", agent_inputs: { assetClass: "STOCK", observationSource: "market_candles", sourceForecastId: sourceId } });
    expect(mock.tables.forecasts[0]).toEqual(old);
    expect(mock.tables.baseline_feature_snapshots[0].liquidity_usd).toBeNull();
    expect(mock.tables.baseline_cohort_members.every(row => row.source_candle_id && row.source_observation_id === null)).toBe(true);
    expect(await service.run(at(50))).toMatchObject({ evaluated: 0 });
    expect(mock.tables.forecasts).toHaveLength(2);
    expect(mock.calls.some(call => call.table === "crypto_market_observations")).toBe(false);
  });

  it("records missing and stale stock data honestly rather than substituting crypto prices", async () => {
    for (const data of [[], [candle(0)]]) {
      const mock = database({ baseline_forecast_pending_targets_v2: [target(at(10))], market_candles: data, crypto_market_observations: [{ asset_id: assetId, price_usd: 100 }] });
      expect(await new BaselineForecastService(mock.db).run(at(10))).toMatchObject({ evaluated: 1, available: 0 });
      expect(mock.tables.forecasts[0]).toMatchObject({ status: "INSUFFICIENT_DATA", expected_return: null, probability_positive: null, reason: data.length ? "TARGET_OBSERVATION_STALE" : "TARGET_DATA_QUALITY_INSUFFICIENT" });
    }
  });
});

type Row = Record<string, any>;
function database(seed: Record<string, Row[]>, failedSource?: string) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const calls: Array<{ table: string; range?: number[] }> = [];
  const db = {
    async rpc(name: string, args: Row) {
      expect(name).toBe("persist_baseline_forecast_bundle_v2");
      if (args.p_forecast.agent_inputs.sourceForecastId === failedSource) return { data: null, error: new Error("Injected atomic persistence failure") };
      const existing = (tables.forecasts ?? []).find(row => row.forecast_key === args.p_forecast.forecast_key);
      if (existing) return { data: { id: existing.id, status: existing.status, reused: true }, error: null };
      for (const [table, rows] of Object.entries({ forecasts: [args.p_forecast], baseline_feature_snapshots: [args.p_snapshot], baseline_cohort_members: args.p_members, event_outbox: [args.p_event] })) {
        tables[table] = [...(tables[table] ?? []), ...rows as Row[]];
      }
      return { data: { id: args.p_forecast.id, status: args.p_forecast.status, reused: false }, error: null };
    }, from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let start = 0, end = 999, single = false, mutation: Row | Row[] | undefined, update: Row | undefined;
      const call: { table: string; range?: number[] } = { table };
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        gte: (key: string, value: string) => { filters.push(row => row[key] >= value); return query; },
        lte: (key: string, value: string) => { filters.push(row => row[key] <= value); return query; },
        lt: (key: string, value: string) => { filters.push(row => row[key] < value); return query; },
        order: (key: string, options = { ascending: true }) => { orders.push([key, options.ascending]); return query; },
        range: (from: number, to: number) => { start = from; end = to; call.range = [from, to]; return query; },
        limit: (limit: number) => { end = limit - 1; return query; },
        insert: (rows: Row | Row[]) => { mutation = rows; return query; },
        update: (fields: Row) => { update = fields; return query; },
        maybeSingle: () => { single = true; return query; },
        single: () => { single = true; return query; },
        then: (resolve: (value: any) => unknown, reject: (error: unknown) => unknown) => {
          try {
            calls.push(call);
            let rows = tables[table] ?? [];
            if (mutation) {
              const created = (Array.isArray(mutation) ? mutation : [mutation]).map(row => ({ id: crypto.randomUUID(), ...row }));
              tables[table] = [...rows, ...created]; rows = created;
            } else {
              rows = rows.filter(row => filters.every(filter => filter(row)));
              if (table === "baseline_forecast_pending_targets_v2") rows = rows.filter(source => !(tables.forecasts ?? []).some(row => row.forecast_version === BASELINE_FORECAST_VERSION && row.agent_inputs?.sourceForecastId === source.id));
              if (update) rows.forEach(row => Object.assign(row, update));
            }
            rows = [...rows].sort((a, b) => { for (const [key, ascending] of orders) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return ascending ? comparison : -comparison; } return 0; });
            rows = rows.slice(start, Math.min(end + 1, start + 1_000));
            return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return { db, tables, calls };
}
