import { describe, expect, it } from "vitest";
import { assessMeta, type MetaAssessmentInput } from "../src/domain/meta-agent";

const cutoff = "2026-08-24T12:00:00.000Z";
function input(overrides: Partial<MetaAssessmentInput> = {}): MetaAssessmentInput {
  return { assetId: "asset-1", horizon: "30m", informationCutoffAt: cutoff,
    consensus: { id: "consensus-1", availableAt: cutoff, result: "MODERATELY_BULLISH", confidence: 75, conflictLevel: "NONE", criticalVetoAgent: null, independentEvidenceGroups: 3, dataQuality: 82 },
    regime: { id: "regime-1", availableAt: cutoff, regime: "RISK_ON", confidence: 80 }, expectedAgentIds: ["MOMENTUM"],
    performance: [{ id: "perf-1", agentId: "MOMENTUM", availableAt: cutoff, status: "AVAILABLE", independentEdge: "HIGH", incrementalValue: { status: "VALUE", value: 7 } }], ...overrides };
}
describe("meta agent foundation v1", () => {
  it("returns watch and readiness when every foundation requirement passes", () => { const result = assessMeta(input()); expect(result).toMatchObject({ decision: "WATCH", readyForPolicyEvaluation: true, requirementsFailed: [], requirementsUnknown: [] }); });
  it("rejects an explicit critical risk veto", () => { const base = input(); const result = assessMeta(input({ consensus: { ...base.consensus!, result: "CONFLICTED", criticalVetoAgent: "TOKEN_RISK", conflictLevel: "HIGH" } })); expect(result.decision).toBe("REJECT"); expect(result.requirementsFailed).toContain("CRITICAL_VETO_CLEAR"); });
  it("returns insufficient data when consensus is absent", () => { expect(assessMeta(input({ consensus: null })).decision).toBe("INSUFFICIENT_DATA"); });
  it("watches a directional setup when performance is not proven", () => { const result = assessMeta(input({ performance: [] })); expect(result.decision).toBe("WATCH"); expect(result.requirementsUnknown).toContain("AGENT_PERFORMANCE_PROVEN"); });
  it("does not invent regime information", () => { const result = assessMeta(input({ regime: null })); expect(result.requirements.find((x) => x.code === "MARKET_REGIME_AVAILABLE")?.status).toBe("UNKNOWN"); });
  it("rejects future evidence", () => { expect(() => assessMeta(input({ regime: { id: "future", availableAt: "2026-08-25T00:00:00.000Z", regime: "RISK_ON", confidence: 90 } }))).toThrow("Future meta input rejected"); });
  it("is deterministic", () => { expect(assessMeta(input()).resultHash).toBe(assessMeta(input()).resultHash); });
});
