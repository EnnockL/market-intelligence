import { describe, expect, it } from "vitest";
import { evaluateStrategyCandidate } from "@/domain/strategy-candidate-triage";

const trades = (count: number, r = 0.2) => Array.from({ length: count }, (_, index) => ({ tradeKey: `trade-${index}`, rMultiple: index % 3 === 0 ? -0.2 : r }));
const base = {
  strategyDefinitionId: "strategy",
  lifecycleState: "RESEARCH",
  cutoffAt: "2026-08-27T12:00:00Z",
  runs: [
    { runId: "run-a", assetId: "a", candleCount: 2000, trades: trades(20) },
    { runId: "run-b", assetId: "b", candleCount: 2000, trades: trades(20).map((x) => ({ ...x, tradeKey: `b-${x.tradeKey}` })) },
  ],
};

describe("strategy candidate triage", () => {
  it("prioritizes only a sufficiently covered positive research candidate", () => {
    expect(evaluateStrategyCandidate(base).recommendation).toBe("PRIORITIZE");
  });
  it("keeps insufficient coverage explicit", () => {
    const result = evaluateStrategyCandidate({ ...base, runs: [base.runs[0]] });
    expect(result.recommendation).toBe("COLLECT_MORE_DATA");
    expect(result.blockers).toContain("ASSET_COVERAGE_INSUFFICIENT");
  });
  it("does not prioritize observed negative expectancy", () => {
    const negative = base.runs.map((run) => ({ ...run, trades: run.trades.map((trade) => ({ ...trade, rMultiple: -0.2 })) }));
    expect(evaluateStrategyCandidate({ ...base, runs: negative }).recommendation).toBe("DO_NOT_PRIORITIZE");
  });
  it("never revives rejected history", () => {
    expect(evaluateStrategyCandidate({ ...base, lifecycleState: "REJECTED" }).recommendation).toBe("EXCLUDED_REJECTED");
  });
  it("is idempotent across scheduler cutoffs with unchanged evidence", () => {
    expect(evaluateStrategyCandidate(base).triageKey).toBe(evaluateStrategyCandidate({ ...base, cutoffAt: "2026-08-27T13:00:00Z" }).triageKey);
  });
  it("deduplicates repeated trade evidence", () => {
    const duplicated = { ...base, runs: [...base.runs, { ...base.runs[0], runId: "duplicate" }] };
    expect(evaluateStrategyCandidate(duplicated).metrics.tradeCount).toBe(40);
  });
});
