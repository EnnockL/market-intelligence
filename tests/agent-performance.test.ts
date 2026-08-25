import { describe, expect, it } from "vitest";
import { calculateAgentPerformance, type AgentEvaluationPoint } from "../src/domain/agent-performance";

function point(index: number, overrides: Partial<AgentEvaluationPoint> = {}): AgentEvaluationPoint {
  return {
    id: String(index).padStart(3, "0"),
    stance: "BULLISH",
    actualReturn: 5,
    maxFavorableExcursion: 8,
    maxAdverseExcursion: -2,
    dataQuality: 85,
    overlapLevels: ["LOW"],
    consensusWithCorrect: true,
    consensusWithoutCorrect: false,
    ...overrides,
  };
}

describe("agent performance v1", () => {
  it("returns insufficient data instead of zero metrics for small samples", () => {
    const result = calculateAgentPerformance([point(1)]);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.metrics.directionalAccuracy).toMatchObject({ status: "INSUFFICIENT_DATA", value: null });
    expect(result.independentEdge).toBe("NOT_PROVEN");
  });

  it("calculates performance after the minimum sample", () => {
    const result = calculateAgentPerformance(Array.from({ length: 30 }, (_, index) => point(index)));
    expect(result.status).toBe("AVAILABLE");
    expect(result.metrics.directionalAccuracy).toMatchObject({ status: "VALUE", value: 100 });
    expect(result.metrics.incrementalValue).toMatchObject({ status: "VALUE", value: 100 });
    expect(result.independentEdge).toBe("HIGH");
  });

  it("penalizes highly overlapping evidence", () => {
    const result = calculateAgentPerformance(
      Array.from({ length: 30 }, (_, index) => point(index, { overlapLevels: ["HIGH"] })),
    );
    expect(result.metrics.overlapPenalty).toMatchObject({ status: "VALUE", value: 100 });
    expect(result.independentEdge).toBe("LOW");
  });

  it("keeps MAE unknown without numeric forecasts", () => {
    const result = calculateAgentPerformance(Array.from({ length: 30 }, (_, index) => point(index)));
    expect(result.metrics.meanAbsoluteError).toMatchObject({
      status: "INSUFFICIENT_DATA",
      reason: "AGENT_DID_NOT_PUBLISH_NUMERIC_RETURN_FORECAST",
    });
  });

  it("is deterministic", () => {
    const points = Array.from({ length: 30 }, (_, index) => point(index));
    expect(calculateAgentPerformance(points).inputHash).toBe(calculateAgentPerformance(points).inputHash);
  });
});
