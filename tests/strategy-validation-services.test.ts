import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationAutomationService } from "@/services/strategy-validation/automation-service";
import { StrategyValidationService } from "@/services/strategy-validation/service";

const cutoffAt = "2026-09-07T12:00:00.000Z";
const at = (hour: string) => `2026-09-07T${hour}:00.000Z`;
const hypothesis = { id: "hypothesis", hypothesis_key: "versioned-hypothesis", strategy_definition_id: "definition", registered_at: "2026-09-01T00:00:00.000Z", available_at: "2026-09-01T00:00:00.000Z", invalidation_condition: "Price closes back inside the opening range." };
const definition = { id: "definition", strategy_key: "orb", version: 1, timeframe: "5m" };
const trade = (key: string, entered: string, exited: string, r: number) => ({ trade_key: key, entered_at: at(entered), exited_at: at(exited), r_multiple: r, regime: "RISK_ON" });
function run(id: string, trades: ReturnType<typeof trade>[], assetId = id) {
  return { id, strategy_definition_id: definition.id, strategy_definitions: definition, asset_id: assetId, information_cutoff_at: cutoffAt, available_at: cutoffAt, input_hash: `input-${id}`, trade_count: trades.length, strategy_evaluation_trades: trades };
}
function tables(runs: ReturnType<typeof run>[]) {
  return {
    strategy_hypotheses: [hypothesis],
    strategy_evaluation_runs: runs,
    strategy_validation_protocols: [{ id: "protocol", protocol_key: "strategy-validation-protocol", version: 1, definition: {} }],
    market_candles: runs.map(item => ({ asset_id: item.asset_id, timeframe: "5m", opened_at: at("09:00"), closed_at: at("10:00"), available_at: at("10:00"), data_quality: 95 })),
    strategy_validation_runs: [] as Record<string, any>[],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("validation automation database adapter", () => {
  it("maps stored window_end so an approved predecessor permits a later non-overlapping window", async () => {
    const rows = tables([run("after-learning", [trade("new-trade", "09:00", "10:00", 1)])]);
    rows.strategy_validation_runs = [{ id: "learning", strategy_definition_id: definition.id, hypothesis_id: hypothesis.id, phase: "LEARNING", decision: "APPROVED", window_end: "2026-09-06T16:00:00.000Z", information_cutoff_at: "2026-09-06T16:00:00.000Z", available_at: "2026-09-06T16:00:00.000Z" }];
    const memory = database(rows);
    const validate = vi.spyOn(StrategyValidationService.prototype, "validate").mockResolvedValue({} as any);
    const result = await new ValidationAutomationService(memory.db).plan(cutoffAt);
    expect(result).toMatchObject({ evaluated: 1, ready: 1, validated: 1, insufficient: 0 });
    expect(validate).toHaveBeenCalledExactlyOnceWith({ evaluationRunIds: ["after-learning"], hypothesisId: hypothesis.id, phase: "FROZEN" });
    expect(memory.rows.strategy_validation_window_plans[0]).toMatchObject({ status: "READY", phase: "FROZEN", window_start: at("09:00"), window_end: at("10:00") });
  });

  it.each(["APPROVED", "REJECTED", "INSUFFICIENT_DATA"])("preserves overlap and predecessor guards for %s learning evidence", async decision => {
    const rows = tables([run("overlap", [trade("overlap-trade", "09:00", "11:00", 1)])]);
    rows.strategy_validation_runs = [{ id: "learning", strategy_definition_id: definition.id, hypothesis_id: hypothesis.id, phase: "LEARNING", decision, window_end: at("10:00"), information_cutoff_at: at("10:00"), available_at: at("10:00") }];
    const memory = database(rows);
    const validate = vi.spyOn(StrategyValidationService.prototype, "validate").mockResolvedValue({} as any);
    const result = await new ValidationAutomationService(memory.db).plan(cutoffAt);
    expect(result.validated).toBe(0);
    expect(validate).not.toHaveBeenCalled();
    expect(memory.rows.strategy_validation_window_plans[0]).toMatchObject({
      status: decision === "APPROVED" ? "INSUFFICIENT_DATA" : "BLOCKED",
      reason: decision === "APPROVED" ? "NO_NON_OVERLAPPING_POST_FREEZE_WINDOW" : `PREVIOUS_PHASE_${decision}`,
    });
  });
});

describe("validation service overlapping trade window", () => {
  it("uses maximum exit time across runs and retains every completed trade without rewriting old results", async () => {
    const rows = tables([
      run("early-long", [trade("early", "09:00", "11:00", 2)]),
      run("later-short", [trade("later", "10:00", "10:30", -1)]),
    ]);
    const legacy = { id: "legacy-validation", validation_key: "legacy-shortened-window", window_end: at("10:30"), metrics: { sampleSize: 1 } };
    rows.strategy_validation_runs = [legacy];
    const memory = database(rows);
    const service = new StrategyValidationService(memory.db);
    const input = { evaluationRunIds: ["later-short", "early-long"], hypothesisId: hypothesis.id, phase: "LEARNING" as const };
    const result = await service.validate(input);
    expect(result.result.inputTradeIds).toEqual(["early", "later"]);
    expect(result.result.metrics).toMatchObject({ sampleSize: 2, expectedValueR: 0.5 });
    expect(memory.rows.strategy_validation_runs[0]).toEqual(legacy);
    expect(memory.rows.strategy_validation_runs[1]).toMatchObject({ window_start: at("09:00"), window_end: at("11:00"), input_snapshot_ids: ["early-long", "later-short"] });
    const retry = await service.validate({ ...input, evaluationRunIds: [...input.evaluationRunIds].reverse() });
    expect(retry).toMatchObject({ reused: true, validationRunId: result.validationRunId });
    expect(memory.rows.strategy_validation_runs).toHaveLength(2);
  });

  it("keeps an empty evaluation insufficient with its cutoff as both boundaries", async () => {
    const memory = database(tables([run("empty", [])]));
    const result = await new StrategyValidationService(memory.db).validate({ evaluationRunId: "empty", hypothesisId: hypothesis.id, phase: "LEARNING" });
    expect(result.result.decision).toBe("INSUFFICIENT_DATA");
    expect(result.result.metrics.sampleSize).toBe(0);
    expect(memory.rows.strategy_validation_runs[0]).toMatchObject({ window_start: cutoffAt, window_end: cutoffAt });
  });

  it("rejects a maximum exit after cutoff instead of silently omitting the future trade", async () => {
    const memory = database(tables([run("future-exit", [trade("early", "09:00", "13:00", 2), trade("later", "10:00", "10:30", -1)])]));
    await expect(new StrategyValidationService(memory.db).validate({ evaluationRunId: "future-exit", hypothesisId: hypothesis.id, phase: "LEARNING" })).rejects.toThrow("INVALID_POINT_IN_TIME_WINDOW");
    expect(memory.rows.strategy_validation_runs).toHaveLength(0);
  });

  it("does not weaken frozen-hypothesis or phase-overlap checks", async () => {
    const rows = tables([run("overlap", [trade("early", "09:00", "11:00", 2)])]);
    rows.strategy_validation_runs = [{ id: "prior", strategy_definition_id: definition.id, hypothesis_id: hypothesis.id, phase: "FROZEN", decision: "APPROVED", window_end: at("10:00"), information_cutoff_at: at("10:00") }];
    const memory = database(rows);
    const service = new StrategyValidationService(memory.db);
    await expect(service.validate({ evaluationRunId: "overlap", hypothesisId: hypothesis.id, phase: "OUT_OF_SAMPLE" })).rejects.toThrow("VALIDATION_WINDOW_OVERLAP");
    memory.rows.strategy_hypotheses[0].registered_at = at("09:30");
    await expect(service.validate({ evaluationRunId: "overlap", hypothesisId: hypothesis.id, phase: "OUT_OF_SAMPLE" })).rejects.toThrow("HYPOTHESIS_NOT_FROZEN_BEFORE_EVALUATION_WINDOW");
    expect(memory.rows.strategy_validation_runs).toHaveLength(1);
  });

  it("retains the concentration gate for a profitable single-asset sample", async () => {
    const trades = Array.from({ length: 40 }, (_, i) => ({ ...trade(`trade-${i}`, "09:00", "10:00", i % 4 === 0 ? -0.5 : 1), regime: i % 2 ? "RISK_ON" : "SIDEWAYS" }));
    const memory = database(tables([run("single-asset", trades)]));
    const result = await new StrategyValidationService(memory.db).validate({ evaluationRunId: "single-asset", hypothesisId: hypothesis.id, phase: "LEARNING", independentPeriods: 2 });
    expect(result.result.gates.find(gate => gate.code === "ASSET_CONCENTRATION")).toMatchObject({ status: "FAIL", observedValue: 1, requiredValue: "<= 0.6" });
    expect(result.result.decision).toBe("REJECTED");
  });
});

/** Memory-only service fake. No credentials, providers, real jobs or network calls. */
function database(initial: Record<string, Record<string, any>[]>) {
  const rows = structuredClone(initial);
  const db = { from(table: string) {
    const predicates: Array<(row: Record<string, any>) => boolean> = [];
    const ordering: Array<{ key: string; ascending: boolean }> = [];
    let rowLimit = Infinity, single = false, optional = false;
    let mutation: Record<string, any> | null = null;
    let conflictKey: string | undefined;
    const chain: any = {
      select() { return chain; },
      eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return chain; },
      in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return chain; },
      lte(key: string, value: string) { predicates.push(row => row[key] <= value); return chain; },
      gte(key: string, value: string) { predicates.push(row => row[key] >= value); return chain; },
      order(key: string, options: { ascending?: boolean } = {}) { ordering.push({ key, ascending: options.ascending ?? true }); return chain; },
      limit(value: number) { rowLimit = value; return chain; },
      single() { single = true; return chain; },
      maybeSingle() { single = true; optional = true; return chain; },
      insert(value: Record<string, any>) { mutation = value; return chain; },
      upsert(value: Record<string, any>, options: { onConflict: string }) { mutation = value; conflictKey = options.onConflict; return chain; },
      then(resolve: (result: unknown) => unknown) {
        rows[table] ??= [];
        if (mutation) {
          const existing = conflictKey && rows[table].find(row => row[conflictKey!] === mutation![conflictKey!]);
          if (!existing) rows[table].push({ id: `${table}-${rows[table].length}`, ...structuredClone(mutation) });
          return Promise.resolve({ data: existing || rows[table].at(-1), error: null }).then(resolve);
        }
        const found = rows[table].filter(row => predicates.every(predicate => predicate(row))).sort((a, b) => {
          for (const { key, ascending } of ordering) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return ascending ? comparison : -comparison; }
          return 0;
        }).slice(0, rowLimit);
        return Promise.resolve({ data: single ? found[0] ?? null : found, error: single && !optional && !found.length ? { message: "Missing fixture" } : null }).then(resolve);
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { db, rows };
}
