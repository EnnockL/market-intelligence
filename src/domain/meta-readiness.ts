import { deterministicDigest } from "@/domain/events";

export const META_READINESS_POLICY_VERSION = "meta-readiness-policy-v1";
export const META_READINESS_POLICY = { minimumAssessments: 30, minimumCoveragePct: 80, requiredHorizons: ["5m", "30m", "2h", "24h"], minimumReadyCalibrationBuckets: 3 } as const;
export type ReadinessStatus = "READY" | "COLLECTING" | "BLOCKED";
export interface ReadinessRequirement { code: string; status: "PASS" | "FAIL" | "UNKNOWN"; observed: unknown; required: unknown; reason: string | null; }
export interface ReadinessAssessment { id: string; decision: string; requirements: Array<{ code: string; status: string }> }
export interface ForecastReadinessGroup { id: string; horizon: string; status: string; sampleSize: number; readyCalibrationBuckets: number; }

export function calculateMetaReadiness(assessments: ReadinessAssessment[], groups: ForecastReadinessGroup[]) {
  const ordered = [...assessments].sort((a, b) => a.id.localeCompare(b.id));
  const coverage = (code: string) => ordered.length ? ordered.filter((item) => item.requirements.some((requirement) => requirement.code === code && requirement.status !== "UNKNOWN")).length / ordered.length * 100 : null;
  const decisionCoverage = ordered.length ? ordered.filter((item) => item.decision !== "INSUFFICIENT_DATA").length / ordered.length * 100 : null;
  const latestGroups = new Map<string, ForecastReadinessGroup>(); for (const group of groups) if (!latestGroups.has(group.horizon)) latestGroups.set(group.horizon, group);
  const readyHorizons = META_READINESS_POLICY.requiredHorizons.filter((horizon) => latestGroups.get(horizon)?.status === "AVAILABLE");
  const calibratedHorizons = META_READINESS_POLICY.requiredHorizons.filter((horizon) => (latestGroups.get(horizon)?.readyCalibrationBuckets ?? 0) >= META_READINESS_POLICY.minimumReadyCalibrationBuckets);
  const requirements: ReadinessRequirement[] = [
    threshold("META_ASSESSMENT_SAMPLE", ordered.length, META_READINESS_POLICY.minimumAssessments, "ASSESSMENT_SAMPLE_INSUFFICIENT"),
    coverageRequirement("META_DECISION_COVERAGE", decisionCoverage, "META_DECISION_COVERAGE_INSUFFICIENT"),
    coverageRequirement("MARKET_REGIME_COVERAGE", coverage("MARKET_REGIME_AVAILABLE"), "MARKET_REGIME_COVERAGE_INSUFFICIENT"),
    coverageRequirement("AGENT_PERFORMANCE_COVERAGE", coverage("AGENT_PERFORMANCE_PROVEN"), "AGENT_PERFORMANCE_COVERAGE_INSUFFICIENT"),
    listRequirement("FORECAST_HORIZONS_READY", readyHorizons, META_READINESS_POLICY.requiredHorizons, "FORECAST_HORIZONS_NOT_READY"),
    listRequirement("CALIBRATION_HORIZONS_READY", calibratedHorizons, META_READINESS_POLICY.requiredHorizons, "CALIBRATION_NOT_READY"),
  ];
  const unknown = requirements.some((item) => item.status === "UNKNOWN"), failed = requirements.some((item) => item.status === "FAIL");
  const status: ReadinessStatus = !failed && !unknown ? "READY" : ordered.length === 0 ? "BLOCKED" : "COLLECTING";
  const result = { policyVersion: META_READINESS_POLICY_VERSION, status, requirements, assessmentCount: ordered.length, decisionCoveragePct: decisionCoverage, readyHorizons, calibratedHorizons, blockers: requirements.filter((item) => item.status !== "PASS").map((item) => item.reason).filter(Boolean) };
  return { ...result, inputHash: deterministicDigest({ assessments: ordered, groups, policy: META_READINESS_POLICY }), resultHash: deterministicDigest(result) };
}
function threshold(code: string, observed: number, required: number, reason: string): ReadinessRequirement { return { code, status: observed >= required ? "PASS" : "FAIL", observed, required, reason: observed >= required ? null : reason }; }
function coverageRequirement(code: string, observed: number | null, reason: string): ReadinessRequirement { return { code, status: observed === null ? "UNKNOWN" : observed >= META_READINESS_POLICY.minimumCoveragePct ? "PASS" : "FAIL", observed, required: META_READINESS_POLICY.minimumCoveragePct, reason: observed !== null && observed >= META_READINESS_POLICY.minimumCoveragePct ? null : reason }; }
function listRequirement(code: string, observed: readonly string[], required: readonly string[], reason: string): ReadinessRequirement { return { code, status: required.every((item) => observed.includes(item)) ? "PASS" : "FAIL", observed, required, reason: required.every((item) => observed.includes(item)) ? null : reason }; }
