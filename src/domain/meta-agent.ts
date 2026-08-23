import { deterministicDigest } from "@/domain/events";

export const META_AGENT_POLICY_VERSION = "meta-agent-policy-v1";

export type MetaDecision = "WATCH" | "REJECT" | "INSUFFICIENT_DATA";
export type MetaRequirementStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";

export interface MetaRequirement {
  code: string;
  status: MetaRequirementStatus;
  observedValue: unknown;
  requiredValue: unknown;
  blockerCode: string | null;
  evidenceRefs: string[];
}

export interface MetaPerformanceInput {
  id: string;
  agentId: string;
  availableAt: string;
  status: "AVAILABLE" | "INSUFFICIENT_DATA";
  independentEdge: "HIGH" | "MEDIUM" | "LOW" | "NOT_PROVEN";
  incrementalValue: { status: "VALUE"; value: number } | { status: "INSUFFICIENT_DATA"; value: null };
}

export interface MetaAssessmentInput {
  assetId: string;
  horizon: string;
  informationCutoffAt: string;
  consensus: {
    id: string;
    availableAt: string;
    result: string;
    confidence: number | null;
    conflictLevel: string;
    criticalVetoAgent: string | null;
    independentEvidenceGroups: number;
    dataQuality: number | null;
  } | null;
  regime: {
    id: string;
    availableAt: string;
    regime: string;
    confidence: number | null;
  } | null;
  performance: MetaPerformanceInput[];
  expectedAgentIds: string[];
}

export const META_AGENT_POLICY = {
  version: META_AGENT_POLICY_VERSION,
  minimumIndependentEvidenceGroups: 2,
  minimumConsensusDataQuality: 70,
} as const;

export function assessMeta(input: MetaAssessmentInput) {
  assertPointInTime(input);
  const refs = (values: Array<string | null | undefined>) => values.filter((x): x is string => Boolean(x));
  const consensus = input.consensus;
  const performanceByAgent = new Map(input.performance.map((item) => [item.agentId, item]));
  const expectedPerformance = [...new Set(input.expectedAgentIds)].sort().map((id) => performanceByAgent.get(id)).filter(Boolean) as MetaPerformanceInput[];
  const availablePerformance = expectedPerformance.filter((item) => item.status === "AVAILABLE");
  const positiveIncremental = availablePerformance.filter((item) => item.incrementalValue.status === "VALUE" && item.incrementalValue.value > 0);
  const requirements: MetaRequirement[] = [
    requirement("CONSENSUS_AVAILABLE", consensus ? "PASS" : "UNKNOWN", consensus?.result ?? null, "CONSENSUS_SNAPSHOT", consensus ? null : "CONSENSUS_MISSING", refs([consensus?.id])),
    requirement("CRITICAL_VETO_CLEAR", consensus?.criticalVetoAgent ? "FAIL" : consensus ? "PASS" : "UNKNOWN", consensus?.criticalVetoAgent ?? null, null, consensus?.criticalVetoAgent ? "CRITICAL_VETO_PRESENT" : consensus ? null : "CONSENSUS_MISSING", refs([consensus?.id])),
    requirement("CONSENSUS_DIRECTIONAL", !consensus ? "UNKNOWN" : directional(consensus.result) ? "PASS" : consensus.result === "CONFLICTED" ? "FAIL" : "UNKNOWN", consensus?.result ?? null, "MODERATELY_BULLISH_OR_BEARISH", consensus?.result === "CONFLICTED" ? "CONSENSUS_CONFLICTED" : directional(consensus?.result) ? null : "DIRECTIONAL_CONSENSUS_MISSING", refs([consensus?.id])),
    requirement("INDEPENDENT_EVIDENCE", !consensus ? "UNKNOWN" : consensus.independentEvidenceGroups >= META_AGENT_POLICY.minimumIndependentEvidenceGroups ? "PASS" : "FAIL", consensus?.independentEvidenceGroups ?? null, META_AGENT_POLICY.minimumIndependentEvidenceGroups, consensus && consensus.independentEvidenceGroups < META_AGENT_POLICY.minimumIndependentEvidenceGroups ? "INDEPENDENT_EVIDENCE_BELOW_THRESHOLD" : consensus ? null : "CONSENSUS_MISSING", refs([consensus?.id])),
    requirement("CONSENSUS_DATA_QUALITY", consensus?.dataQuality == null ? "UNKNOWN" : consensus.dataQuality >= META_AGENT_POLICY.minimumConsensusDataQuality ? "PASS" : "FAIL", consensus?.dataQuality ?? null, META_AGENT_POLICY.minimumConsensusDataQuality, consensus?.dataQuality == null ? "CONSENSUS_DATA_QUALITY_UNKNOWN" : consensus.dataQuality < META_AGENT_POLICY.minimumConsensusDataQuality ? "CONSENSUS_DATA_QUALITY_BELOW_THRESHOLD" : null, refs([consensus?.id])),
    requirement("MARKET_REGIME_AVAILABLE", !input.regime || input.regime.regime === "UNKNOWN" ? "UNKNOWN" : "PASS", input.regime?.regime ?? null, "KNOWN_REGIME", !input.regime ? "MARKET_REGIME_MISSING" : input.regime.regime === "UNKNOWN" ? "MARKET_REGIME_UNKNOWN" : null, refs([input.regime?.id])),
    requirement("AGENT_PERFORMANCE_PROVEN", input.expectedAgentIds.length === 0 || availablePerformance.length === 0 ? "UNKNOWN" : "PASS", availablePerformance.length, ">=1_AVAILABLE_AGENT", availablePerformance.length ? null : "AGENT_PERFORMANCE_UNPROVEN", expectedPerformance.map((item) => item.id)),
    requirement("INCREMENTAL_VALUE_PROVEN", availablePerformance.length === 0 ? "UNKNOWN" : positiveIncremental.length ? "PASS" : "FAIL", positiveIncremental.length, ">=1_POSITIVE_INCREMENTAL_VALUE", availablePerformance.length === 0 ? "INCREMENTAL_VALUE_UNKNOWN" : positiveIncremental.length ? null : "NO_POSITIVE_INCREMENTAL_VALUE", availablePerformance.map((item) => item.id)),
  ];
  const failed = requirements.filter((item) => item.status === "FAIL");
  const unknown = requirements.filter((item) => item.status === "UNKNOWN");
  const criticalReject = failed.some((item) => item.code === "CRITICAL_VETO_CLEAR" || item.code === "CONSENSUS_DIRECTIONAL");
  const decision: MetaDecision = criticalReject ? "REJECT" : unknown.length ? (directional(consensus?.result) ? "WATCH" : "INSUFFICIENT_DATA") : failed.length ? "WATCH" : "WATCH";
  const readyForPolicyEvaluation = failed.length === 0 && unknown.length === 0;
  const result = {
    policyVersion: META_AGENT_POLICY_VERSION,
    decision,
    reason: criticalReject ? failed[0].blockerCode : unknown[0]?.blockerCode ?? failed[0]?.blockerCode ?? "FOUNDATION_REQUIREMENTS_PASSED",
    readyForPolicyEvaluation,
    requirements,
    requirementsPassed: requirements.filter((item) => item.status === "PASS").map((item) => item.code),
    requirementsFailed: failed.map((item) => item.code),
    requirementsUnknown: unknown.map((item) => item.code),
    inputRefs: refs([consensus?.id, input.regime?.id, ...expectedPerformance.map((item) => item.id)]).sort(),
    dataQuality: consensus?.dataQuality ?? null,
  };
  return { ...result, inputHash: deterministicDigest({ input, policy: META_AGENT_POLICY }), resultHash: deterministicDigest(result) };
}

function requirement(code: string, status: MetaRequirementStatus, observedValue: unknown, requiredValue: unknown, blockerCode: string | null, evidenceRefs: string[]): MetaRequirement {
  return { code, status, observedValue, requiredValue, blockerCode, evidenceRefs: [...new Set(evidenceRefs)].sort() };
}
function directional(value?: string | null) { return value === "MODERATELY_BULLISH" || value === "MODERATELY_BEARISH"; }
function assertPointInTime(input: MetaAssessmentInput) {
  const timestamps = [input.consensus?.availableAt, input.regime?.availableAt, ...input.performance.map((item) => item.availableAt)].filter(Boolean) as string[];
  if (timestamps.some((timestamp) => timestamp > input.informationCutoffAt)) throw new Error("Future meta input rejected");
}
