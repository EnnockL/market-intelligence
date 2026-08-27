import { describe, expect, it } from "vitest";
import { evaluateResearchCycle } from "@/domain/strategy-research-cycle";

const base = {
  strategyDefinitionId: "strategy",
  hypothesisId: "hypothesis",
  evaluationRunId: "run",
  evaluationStatus: "AVAILABLE" as const,
  lifecycleState: "RESEARCH",
  tradeCount: 30,
  setupCount: 35,
  minimumSampleSize: 30,
  cutoffAt: "2026-08-27T12:00:00Z",
};

describe("strategy research cycle", () => {
  it("marks a complete immutable sample ready for validation", () => {
    expect(evaluateResearchCycle(base).status).toBe("READY_FOR_VALIDATION");
  });
  it("keeps small samples collecting rather than inventing performance", () => {
    const result = evaluateResearchCycle({ ...base, evaluationStatus: "INSUFFICIENT_DATA", tradeCount: 12 });
    expect(result.status).toBe("COLLECTING");
    expect(result.blockers).toContain("MINIMUM_SAMPLE_NOT_REACHED");
  });
  it("never revives a rejected hypothesis", () => {
    expect(evaluateResearchCycle({ ...base, lifecycleState: "REJECTED" }).status).toBe("REJECTED");
  });
  it("is deterministic for the same cutoff and evidence", () => {
    expect(evaluateResearchCycle(base).cycleKey).toBe(evaluateResearchCycle(base).cycleKey);
  });
  it("does not duplicate unchanged evidence at a later scheduler cutoff", () => {
    expect(evaluateResearchCycle(base).cycleKey).toBe(
      evaluateResearchCycle({ ...base, cutoffAt: "2026-08-27T12:15:00Z" }).cycleKey,
    );
  });
});
