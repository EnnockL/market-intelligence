import { deterministicDigest } from "@/domain/events";

export const QUALIFICATION_POLICY_V1 = {
  version: "jackpot-qualification-policy-v1",
  minimumDataQuality: 80,
  minimumLiquidityUsd: 25_000,
  minimumRawWallets: 3,
  minimumIndependentWallets: 3,
  minimumVerifiedWallets: 3,
  minimumRelationshipCoverage: 80,
  minimumRiskCoverage: 80,
  maximumLatenessMs: 30_000,
  maximumMarketCapUsd: 10_000_000,
  maximumTokenAgeSeconds: 86_400,
  unknownBlocks: [
    "safety", "minimum_data_quality", "liquidity_evidence",
    "wallet_convergence", "wallet_independence", "verified_wallet_quality",
    "relationship_coverage", "token_risk_coverage",
  ],
} as const;

export type RequirementStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type QualificationDecision = "QUALIFIED" | "WATCH" | "REJECTED";
export type DecisionReason = "PASS" | "TRUE_NEGATIVE" | "DATA_BLOCKED";
export interface EvidenceRef { type: string; id: string; availableAt: string; source?: string; dataQuality?: number | null }
export interface QualificationInput {
  candidateId: string; candidateRevision: number; currentState: string; informationCutoffAt: string;
  safety: string | null; dataQuality: number | null; liquidityUsd: number | null;
  rawWalletCount: number | null; independentWallets: number | null; verifiedWallets: number | null;
  relationshipCoverage: number | null; riskCoverage: number | null;
  priceAcceleration: boolean | null; volumeAcceleration: boolean | null;
  latenessMs: number | null; marketCapUsd: number | null; tokenAgeSeconds: number | null;
  newWalletInflow: boolean | null; holderGrowth: boolean | null; holderProviderAvailable: boolean;
  evidence: Partial<Record<RequirementKey, EvidenceRef[]>>;
}
export type RequirementKey = "safety" | "minimum_data_quality" | "liquidity_evidence" | "wallet_convergence" | "wallet_independence" | "verified_wallet_quality" | "relationship_coverage" | "token_risk_coverage" | "price_acceleration" | "volume_acceleration" | "lateness" | "market_cap" | "token_age" | "new_wallet_inflow" | "holder_growth";
export interface RequirementEvaluation { key: RequirementKey; status: RequirementStatus; blockerCode: string | null; observedValue: unknown; requiredValue: unknown; evidenceRefs: EvidenceRef[]; source: string | null; dataQuality: number | null; cutoff: string }
export interface QualificationEvaluation { inputHash: string; policyVersion: string; currentState: string; eligibleNextState: string; requirements: RequirementEvaluation[]; requirementsPassed: number; requirementsFailed: number; requirementsUnknown: number; finalDecision: QualificationDecision; decisionReason: DecisionReason }

function scalar(key: RequirementKey, observed: number | null, required: unknown, pass: (value: number) => boolean, blocker: string, input: QualificationInput): RequirementEvaluation {
  const refs = input.evidence[key] ?? [];
  return requirement(key, observed === null ? "UNKNOWN" : pass(observed) ? "PASS" : "FAIL", observed, required, blocker, refs, input.informationCutoffAt);
}
function flag(key: RequirementKey, observed: boolean | null, required: unknown, blocker: string, input: QualificationInput): RequirementEvaluation {
  const refs = input.evidence[key] ?? [];
  return requirement(key, observed === null ? "UNKNOWN" : observed ? "PASS" : "FAIL", observed, required, blocker, refs, input.informationCutoffAt);
}
function requirement(key: RequirementKey, status: RequirementStatus, observedValue: unknown, requiredValue: unknown, blocker: string, refs: EvidenceRef[], cutoff: string): RequirementEvaluation {
  return { key, status, blockerCode: status === "PASS" || status === "NOT_APPLICABLE" ? null : status === "UNKNOWN" ? `${blocker}_UNKNOWN` : blocker, observedValue, requiredValue, evidenceRefs: refs, source: refs[0]?.source ?? null, dataQuality: refs.length ? Math.min(...refs.map(r => r.dataQuality ?? 0)) : null, cutoff };
}

export function evaluateQualification(input: QualificationInput): QualificationEvaluation {
  const p = QUALIFICATION_POLICY_V1;
  for (const refs of Object.values(input.evidence)) for (const ref of refs ?? []) if (Date.parse(ref.availableAt) > Date.parse(input.informationCutoffAt)) throw new Error(`FUTURE_EVIDENCE_REJECTED:${ref.id}`);
  const requirements: RequirementEvaluation[] = [
    requirement("safety", input.safety === null || input.safety === "UNKNOWN" ? "UNKNOWN" : input.safety === "PASS" ? "PASS" : "FAIL", input.safety, "PASS", "SAFETY_BLOCKED", input.evidence.safety ?? [], input.informationCutoffAt),
    scalar("minimum_data_quality", input.dataQuality, `>= ${p.minimumDataQuality}%`, v => v >= p.minimumDataQuality, "DATA_QUALITY_BELOW_THRESHOLD", input),
    scalar("liquidity_evidence", input.liquidityUsd, `>= $${p.minimumLiquidityUsd}`, v => v >= p.minimumLiquidityUsd, "LIQUIDITY_BELOW_THRESHOLD", input),
    scalar("wallet_convergence", input.rawWalletCount, `>= ${p.minimumRawWallets}`, v => v >= p.minimumRawWallets, "WALLET_CONVERGENCE_INSUFFICIENT", input),
    scalar("wallet_independence", input.independentWallets, `>= ${p.minimumIndependentWallets}`, v => v >= p.minimumIndependentWallets, "WALLET_INDEPENDENCE_INSUFFICIENT", input),
    scalar("verified_wallet_quality", input.verifiedWallets, `>= ${p.minimumVerifiedWallets}`, v => v >= p.minimumVerifiedWallets, "VERIFIED_WALLET_QUALITY_INSUFFICIENT", input),
    coverage("relationship_coverage", input.relationshipCoverage, p.minimumRelationshipCoverage, "RELATIONSHIP_COVERAGE_INSUFFICIENT", input),
    coverage("token_risk_coverage", input.riskCoverage, p.minimumRiskCoverage, "RISK_COVERAGE_INSUFFICIENT", input),
    flag("price_acceleration", input.priceAcceleration, true, "PRICE_ACCELERATION_MISSING", input),
    flag("volume_acceleration", input.volumeAcceleration, true, "VOLUME_ACCELERATION_MISSING", input),
    scalar("lateness", input.latenessMs, `<= ${p.maximumLatenessMs}ms`, v => v <= p.maximumLatenessMs, "LATENESS_ABOVE_THRESHOLD", input),
    scalar("market_cap", input.marketCapUsd, `<= $${p.maximumMarketCapUsd}`, v => v <= p.maximumMarketCapUsd, "MARKET_CAP_ABOVE_THRESHOLD", input),
    scalar("token_age", input.tokenAgeSeconds, `<= ${p.maximumTokenAgeSeconds}s`, v => v <= p.maximumTokenAgeSeconds, "TOKEN_TOO_OLD", input),
    flag("new_wallet_inflow", input.newWalletInflow, true, "NEW_WALLET_INFLOW_MISSING", input),
    input.holderProviderAvailable ? flag("holder_growth", input.holderGrowth, true, "HOLDER_GROWTH_MISSING", input) : requirement("holder_growth", "NOT_APPLICABLE", null, "provider available", "HOLDER_GROWTH_MISSING", [], input.informationCutoffAt),
  ];
  const failed = requirements.filter(r => r.status === "FAIL");
  const blockingUnknown = requirements.filter(r => r.status === "UNKNOWN" && (p.unknownBlocks as readonly string[]).includes(r.key));
  const finalDecision: QualificationDecision = failed.length ? "REJECTED" : blockingUnknown.length ? "WATCH" : "QUALIFIED";
  const decisionReason: DecisionReason = failed.length ? "TRUE_NEGATIVE" : blockingUnknown.length ? "DATA_BLOCKED" : "PASS";
  return { inputHash: deterministicDigest({ input, policy: p }), policyVersion: p.version, currentState: input.currentState, eligibleNextState: finalDecision === "QUALIFIED" ? "QUALIFIED" : finalDecision === "WATCH" ? "WATCHING" : "REJECTED", requirements, requirementsPassed: requirements.filter(r => r.status === "PASS").length, requirementsFailed: failed.length, requirementsUnknown: requirements.filter(r => r.status === "UNKNOWN").length, finalDecision, decisionReason };
}

function coverage(key: "relationship_coverage" | "token_risk_coverage", observed: number | null, minimum: number, blocker: string, input: QualificationInput) {
  const refs = input.evidence[key] ?? [];
  return requirement(key, observed === null || observed < minimum ? "UNKNOWN" : "PASS", observed, `>= ${minimum}%`, blocker, refs, input.informationCutoffAt);
}

export function aggregateQualifications(evaluations: QualificationEvaluation[]) {
  const blockerFrequency: Record<string, number> = {}, unknownFrequency: Record<string, number> = {}, coverageGaps: Record<string, number> = {};
  for (const evaluation of evaluations) for (const r of evaluation.requirements) {
    if (r.status === "FAIL" && r.blockerCode) blockerFrequency[r.blockerCode] = (blockerFrequency[r.blockerCode] ?? 0) + 1;
    if (r.status === "UNKNOWN") { unknownFrequency[r.key] = (unknownFrequency[r.key] ?? 0) + 1; coverageGaps[r.key] = (coverageGaps[r.key] ?? 0) + 1; }
  }
  return { decisions: { qualified: evaluations.filter(e => e.finalDecision === "QUALIFIED").length, watch: evaluations.filter(e => e.finalDecision === "WATCH").length, rejected: evaluations.filter(e => e.finalDecision === "REJECTED").length }, blockerFrequency, unknownFrequency, coverageGaps, policyStrictness: { dataBlocked: evaluations.filter(e => e.decisionReason === "DATA_BLOCKED").length, trueNegative: evaluations.filter(e => e.decisionReason === "TRUE_NEGATIVE").length } };
}
