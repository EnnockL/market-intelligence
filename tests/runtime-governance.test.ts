import { describe, expect, it } from "vitest";
import { assertRuntimeTransition, assessRuntime, capitalStepRecommendation, fractionalKelly, riskOfRuin } from "../src/domain/runtime-governance";

const input = { strategyId: "orb", strategyVersion: 1, state: "LIVE_LIMITED" as const, cutoffAt: "2026-08-26T10:00:00.000Z", validationDecision: "APPROVED" as const, setupPresent: true, invalidationCondition: "close inside range", invalidated: false, regimeEligible: true, criticalDataComplete: true, portfolioCorrelation: 0.3, correlationCoverage: 0.95, rollingExpectedValueR: 0.2, rollingLowerBoundR: 0.04, observations: 50, minimumObservations: 30, recentCriticalBugs: 0, killSwitch: false };

describe("runtime governance v1", () => {
  it("defaults to NO_TRADE when any critical fact is unknown", () => { expect(assessRuntime({ ...input, regimeEligible: null }).decision).toBe("NO_TRADE"); });
  it("permits only the mode represented by lifecycle state", () => { expect(assessRuntime(input).decision).toBe("LIMITED_ELIGIBLE"); expect(assessRuntime({ ...input, state: "APPROVED_SHADOW" }).decision).toBe("SHADOW_ONLY"); });
  it("detects edge decay and requires revalidation", () => { const result = assessRuntime({ ...input, rollingExpectedValueR: -0.1, rollingLowerBoundR: -0.2 }); expect(result.decision).toBe("NO_TRADE"); expect(result.revalidationRequired).toBe(true); });
  it("enforces explicit lifecycle transitions", () => { expect(assertRuntimeTransition("RESEARCH", "FROZEN")).toBe(true); expect(() => assertRuntimeTransition("RESEARCH", "LIVE_APPROVED")).toThrow("INVALID_RUNTIME_TRANSITION"); });
  it("keeps capital unchanged without evidence and manual approval", () => { expect(capitalStepRecommendation(1000, 2000, "PASS", false).decision).toBe("NO_CHANGE"); expect(capitalStepRecommendation(1000, 2000, "PASS", true).decision).toBe("APPROVED"); expect(capitalStepRecommendation(1000, 5000, "PASS", true).decision).toBe("NO_CHANGE"); });
  it("returns bounded risk diagnostics or null for invalid inputs", () => { expect(fractionalKelly(0.6, 1.5, 1)).toBeGreaterThan(0); expect(fractionalKelly(null, 1, 1)).toBeNull(); expect(riskOfRuin(0.6, 1.5, 1, 0.01)).toBeLessThan(1); });
});
