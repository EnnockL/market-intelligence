import { describe, expect, it } from "vitest";
import {
  nextValidationWindow,
  shadowObservation,
} from "./validation-automation";
const base = {
  strategyDefinitionId: "s",
  hypothesisId: "h",
  registeredAt: "2026-01-01T00:00:00Z",
  cutoffAt: "2026-04-01T00:00:00Z",
  completed: [] as any[],
};
describe("validation automation", () => {
  it("selects deterministic earliest available window", () => {
    const result = nextValidationWindow({
      ...base,
      runs: [
        {
          id: "b",
          startsAt: "2026-03-01T00:00:00Z",
          endsAt: "2026-03-02T00:00:00Z",
          availableAt: "2026-03-03T00:00:00Z",
          tradeCount: 2,
        },
        {
          id: "a",
          startsAt: "2026-02-01T00:00:00Z",
          endsAt: "2026-02-02T00:00:00Z",
          availableAt: "2026-02-03T00:00:00Z",
          tradeCount: 2,
        },
      ],
    });
    expect(result.status).toBe("READY");
    expect(result.evaluationRunIds).toEqual(["a"]);
  });
  it("rejects future data", () => {
    const result = nextValidationWindow({
      ...base,
      runs: [
        {
          id: "a",
          startsAt: "2026-02-01T00:00:00Z",
          endsAt: "2026-02-02T00:00:00Z",
          availableAt: "2027-01-01T00:00:00Z",
          tradeCount: 2,
        },
      ],
    });
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });
  it("requires approved predecessor and non-overlap", () => {
    const result = nextValidationWindow({
      ...base,
      completed: [
        {
          phase: "LEARNING",
          decision: "APPROVED",
          windowEnd: "2026-03-01T00:00:00Z",
        },
      ],
      runs: [
        {
          id: "a",
          startsAt: "2026-02-01T00:00:00Z",
          endsAt: "2026-02-02T00:00:00Z",
          availableAt: "2026-02-03T00:00:00Z",
          tradeCount: 2,
        },
      ],
    });
    expect(result.phase).toBe("FROZEN");
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });
  it("does not invent strategy attribution", () => {
    const result = shadowObservation({
      strategyDefinitionId: "s",
      runtimeAssessmentId: "r",
      mode: "SHADOW",
      cutoffAt: "2026-01-01T00:05:00Z",
      bucketStartedAt: "2026-01-01T00:00:00Z",
      globalCounts: {
        proposals: 2,
        intents: 1,
        orders: 1,
        fills: 1,
        rejected: 0,
      },
    });
    expect(result.attributionStatus).toBe("UNKNOWN");
    expect(result.metrics.attributableFills).toBeNull();
  });
});
