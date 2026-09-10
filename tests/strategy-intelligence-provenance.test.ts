import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { classifyResearchProvenance, type LinkedValidationEvidence } from "@/domain/strategy-intelligence-provenance";
import { StrategyIntelligenceService } from "@/services/strategy-intelligence/service";
import { runStrategyIntelligence } from "@/workers/strategy-intelligence";

const cutoffAt = "2026-09-07T12:00:00.000Z";
const historicalCutoff = "2026-08-01T12:00:00.000Z";
const classify = (validations: LinkedValidationEvidence[]) => classifyResearchProvenance({ evaluationRunId: "run", strategyDefinitionId: "definition", evaluationInputHash: "candle-input-hash", cutoffAt, validations });
const validation = (phase: string, extra: Partial<LinkedValidationEvidence> = {}): LinkedValidationEvidence => ({ id: `validation-${phase}`, phase, strategyDefinitionId: "definition", evaluationRunIds: ["run"], availableAt: historicalCutoff, createdAt: historicalCutoff, ...extra });

describe("fail-closed strategy research provenance", () => {
  it("keeps ordinary research exploratory even with a profitable candle input hash", () => {
    expect(classify([])).toMatchObject({ split: "EXPLORATION", provenance: { status: "UNVERIFIED", reason: "FROZEN_DATASET_PROVENANCE_UNAVAILABLE", evaluationInputHash: "candle-input-hash", frozenDatasetId: null, windowSource: "TRADE_SPAN_ONLY" } });
  });

  it("never relabels learning evidence when a later validation also calls it OOS", () => {
    const result = classify([validation("OUT_OF_SAMPLE"), validation("LEARNING"), validation("FROZEN")]);
    expect(result.split).toBe("TRAIN");
    expect(result.provenance.reason).toBe("LEARNING_EVIDENCE_NOT_SELECTION_PROOF");
    expect(result.provenance.observedPhases).toEqual(["FROZEN", "LEARNING", "OUT_OF_SAMPLE"]);
  });

  it("does not confuse post-hoc FROZEN/OOS/DEMO labels with a frozen source manifest", () => {
    for (const phase of ["FROZEN", "OUT_OF_SAMPLE", "DEMO_VALIDATION"]) {
      expect(classify([validation(phase)])).toMatchObject({ split: "EXPLORATION", provenance: { status: "UNVERIFIED", observedPhases: [phase] } });
    }
  });

  it("only records exact run/strategy links known at cutoff, not backdated or future records", () => {
    const excluded = [
      validation("LEARNING", { strategyDefinitionId: "another-strategy" }),
      validation("LEARNING", { evaluationRunIds: ["another-run"] }),
      validation("LEARNING", { availableAt: "2026-09-08T00:00:00.000Z" }),
      validation("LEARNING", { createdAt: "2026-09-08T00:00:00.000Z" }),
      validation("LEARNING", { createdAt: "invalid" }),
    ];
    expect(classify(excluded).provenance.validationRunIds).toEqual([]);
    expect(classify(excluded).split).toBe("EXPLORATION");
  });
});

describe("strategy intelligence service persistence", () => {
  it("publishes exploratory v2 without rewriting legacy validation evidence or backdating availability", async () => {
    const mock = database({ strategy_evaluation_runs: [evaluation()], strategy_performance_snapshots: [{ id: "legacy", snapshot_key: "legacy", performance_version: "strategy-research-v1", dataset_split: "VALIDATION" }], strategy_validation_runs: [validationRow("OUT_OF_SAMPLE")] });
    const service = new StrategyIntelligenceService(mock.db, () => cutoffAt);
    const first = await service.researchEvaluation("run", { cutoffAt });
    expect(first.snapshot).toMatchObject({ split: "EXPLORATION", informationCutoffAt: historicalCutoff, availableAt: cutoffAt, provenance: { reason: "FROZEN_DATASET_PROVENANCE_UNAVAILABLE" } });
    expect(mock.tables.strategy_performance_snapshots[0]).toEqual({ id: "legacy", snapshot_key: "legacy", performance_version: "strategy-research-v1", dataset_split: "VALIDATION" });
    expect(mock.tables.strategy_performance_snapshots[1]).toMatchObject({ dataset_split: "EXPLORATION", available_at: cutoffAt, provenance: { observedPhases: ["OUT_OF_SAMPLE"] } });
    expect(await service.researchEvaluation("run", { cutoffAt })).toMatchObject({ reused: true, snapshotId: first.snapshotId, snapshot: { availableAt: cutoffAt } });
    expect(mock.tables.strategy_performance_snapshots).toHaveLength(2);
  });

  it("keeps learning identifiable and never upgrades it on repeated processing", async () => {
    const mock = database({ strategy_evaluation_runs: [evaluation()], strategy_validation_runs: [validationRow("LEARNING"), validationRow("OUT_OF_SAMPLE")] });
    const service = new StrategyIntelligenceService(mock.db, () => cutoffAt);
    expect((await service.researchEvaluation("run", { cutoffAt })).snapshot.split).toBe("TRAIN");
    expect((await service.researchEvaluation("run", { cutoffAt })).snapshot.split).toBe("TRAIN");
    expect(mock.tables.strategy_performance_snapshots).toHaveLength(1);
  });

  it("fails rather than reading an evaluation that only became known after cutoff", async () => {
    const mock = database({ strategy_evaluation_runs: [evaluation({ created_at: "2026-09-08T00:00:00.000Z" })] });
    await expect(new StrategyIntelligenceService(mock.db, () => cutoffAt).researchEvaluation("run", { cutoffAt })).rejects.toMatchObject({ message: "missing row" });
    expect(mock.tables.strategy_performance_snapshots).toBeUndefined();
  });

  it("uses maximum exit time, not the exit of the last-entered position", async () => {
    const mock = database({ strategy_evaluation_runs: [evaluation({ trade_count: 2, minimum_sample_size: 2, strategy_evaluation_trades: [tradeRow("early", "2026-08-01T09:00:00Z", "2026-08-01T11:00:00Z"), tradeRow("late", "2026-08-01T10:00:00Z", "2026-08-01T10:30:00Z")] })] });
    const result = await new StrategyIntelligenceService(mock.db, () => cutoffAt).researchEvaluation("run", { cutoffAt });
    expect(result.snapshot).toMatchObject({ windowEnd: "2026-08-01T11:00:00.000Z", tradeCount: 2 });
  });

  it("selector reads only current-version results actually available by the cutoff", async () => {
    const common = { asset_id: "asset", timeframe: "5m", information_cutoff_at: historicalCutoff, available_at: historicalCutoff, created_at: historicalCutoff, performance_version: "strategy-research-v2", assets: { symbol: "AMD" }, strategy_definitions: { strategy_key: "orb", version: 1 }, dataset_split: "EXPLORATION", metrics: { expectedValueR: 1 }, provenance: classify([]).provenance };
    const mock = database({ strategy_performance_snapshots: [
      { ...common, snapshot_key: "legacy", performance_version: "strategy-research-v1", dataset_split: "VALIDATION" },
      { ...common, snapshot_key: "late-published", available_at: "2026-09-08T00:00:00.000Z" },
      { ...common, snapshot_key: "backdated", created_at: "2026-09-08T00:00:00.000Z" },
      { ...common, snapshot_key: "exploration" },
    ] });
    const result = await new StrategyIntelligenceService(mock.db, () => cutoffAt).select({ assetId: "asset", asset: "AMD", assetClass: "STOCK", timeframe: "5m", session: "UNKNOWN", regime: "UNKNOWN", volatilityBucket: "UNKNOWN", liquidityBucket: "UNKNOWN", cutoffAt, minimumSampleSize: 30 });
    expect(result.result.status).toBe("NO_STRATEGY_ELIGIBLE");
    expect(mock.tables.strategy_selector_runs[0]).toMatchObject({ selector_version: "strategy-selector-v2", available_at: cutoffAt, input_snapshot_keys: ["exploration"], selected_strategy: null });
  });

  it("worker delegates classification instead of passing a split label", async () => {
    const research = vi.spyOn(StrategyIntelligenceService.prototype, "researchEvaluation").mockResolvedValue({ snapshotId: "snapshot", reused: true, snapshot: {} as any });
    const select = vi.spyOn(StrategyIntelligenceService.prototype, "select").mockResolvedValue({ selectorRunId: "selector", reused: true, result: { status: "NO_STRATEGY_ELIGIBLE", selectedStrategy: null } as any });
    try {
      const mock = database({ strategy_evaluation_runs: [evaluation()], assets: [{ id: "asset", symbol: "AMD", kind: "stock" }] });
      const result = await runStrategyIntelligence(mock.db, cutoffAt);
      expect(research).toHaveBeenCalledExactlyOnceWith("run", { cutoffAt });
      expect(result).toMatchObject({ status: "NO_STRATEGY_ELIGIBLE", researched: 1 });
    } finally { research.mockRestore(); select.mockRestore(); }
  });
});

function evaluation(extra: Record<string, unknown> = {}) {
  return { id: "run", strategy_definition_id: "definition", asset_id: "asset", input_hash: "candle-input-hash", information_cutoff_at: historicalCutoff, available_at: historicalCutoff, created_at: historicalCutoff, trade_count: 0, setup_count: 0, minimum_sample_size: 30, strategy_evaluation_trades: [], strategy_definitions: { id: "definition", strategy_key: "orb", version: 1, market: "NASDAQ", timeframe: "5m" }, assets: { id: "asset", symbol: "AMD", kind: "stock" }, ...extra };
}
function validationRow(phase: string) { return { id: `validation-${phase}`, strategy_definition_id: "definition", input_snapshot_ids: ["run"], available_at: historicalCutoff, created_at: historicalCutoff, phase, decision: "APPROVED" }; }
function tradeRow(key: string, entered: string, exited: string) { return { trade_key: key, side: "LONG", setup_at: entered, entered_at: entered, exited_at: exited, entry: 100, stop: 99, target: 102, exit: 102, outcome: "WIN", r_multiple: 2, mfe_r: 2, mae_r: 0, hold_minutes: 30, evidence_refs: [], session: "NEW_YORK", weekday: "Monday", regime: "UNKNOWN" }; }

/** In-memory SELECT/INSERT fake only: deliberately has no update/upsert/delete. */
function database(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = structuredClone(initial);
  const db = { from(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    const order: Array<{ key: string; ascending: boolean }> = [];
    let limit = Infinity, insert: any = null, single = false, optional = false;
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      contains(key: string, values: unknown[]) { filters.push(row => values.every(value => row[key]?.includes(value))); return query; },
      lte(key: string, value: string) { filters.push(row => Date.parse(row[key]) <= Date.parse(value)); return query; },
      order(key: string, options: { ascending?: boolean } = {}) { order.push({ key, ascending: options.ascending ?? true }); return query; },
      limit(value: number) { limit = value; return query; },
      insert(value: unknown) { insert = value; return query; },
      single() { single = true; return query; },
      maybeSingle() { single = true; optional = true; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (insert) { tables[table] ??= []; const row = { id: `${table}-${tables[table].length}`, created_at: cutoffAt, ...insert }; tables[table].push(row); return Promise.resolve(resolve({ data: row, error: null })); }
        const rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).sort((a, b) => { for (const item of order) { const difference = String(a[item.key]).localeCompare(String(b[item.key])); if (difference) return item.ascending ? difference : -difference; } return 0; }).slice(0, limit);
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: single && !optional && !rows.length ? { message: "missing row" } : null }));
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { db, tables };
}
