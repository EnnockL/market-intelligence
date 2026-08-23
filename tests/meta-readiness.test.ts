import { describe, expect, it } from "vitest";
import { calculateMetaReadiness, type ForecastReadinessGroup, type ReadinessAssessment } from "../src/domain/meta-readiness";
const requirements = [{ code: "MARKET_REGIME_AVAILABLE", status: "PASS" }, { code: "AGENT_PERFORMANCE_PROVEN", status: "PASS" }];
const assessments: ReadinessAssessment[] = Array.from({ length: 30 }, (_, index) => ({ id: `a-${String(index).padStart(2, "0")}`, decision: "WATCH", requirements }));
const groups: ForecastReadinessGroup[] = ["5m", "30m", "2h", "24h"].map((horizon) => ({ id: horizon, horizon, status: "AVAILABLE", sampleSize: 30, readyCalibrationBuckets: 3 }));
describe("meta diagnostics readiness v1", () => {
  it("is ready only when every explicit requirement passes", () => expect(calculateMetaReadiness(assessments, groups).status).toBe("READY"));
  it("collects when assessment sample is incomplete", () => { const result = calculateMetaReadiness(assessments.slice(0, 10), groups); expect(result.status).toBe("COLLECTING"); expect(result.blockers).toContain("ASSESSMENT_SAMPLE_INSUFFICIENT"); });
  it("keeps missing coverage separate from a failed observation", () => { const result = calculateMetaReadiness([], []); expect(result.status).toBe("BLOCKED"); expect(result.requirements.find((x) => x.code === "MARKET_REGIME_COVERAGE")?.status).toBe("UNKNOWN"); });
  it("requires every forecast horizon", () => { const result = calculateMetaReadiness(assessments, groups.slice(0, 3)); expect(result.status).toBe("COLLECTING"); expect(result.readyHorizons).toHaveLength(3); });
  it("requires empirical calibration coverage", () => { const result = calculateMetaReadiness(assessments, groups.map((group) => ({ ...group, readyCalibrationBuckets: 0 }))); expect(result.blockers).toContain("CALIBRATION_NOT_READY"); });
  it("is deterministic", () => expect(calculateMetaReadiness(assessments, groups).resultHash).toBe(calculateMetaReadiness(assessments, groups).resultHash));
});
