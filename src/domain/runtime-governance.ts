import { deterministicDigest } from "./events";
import type { GateStatus } from "./strategy-validation";

export const RUNTIME_GOVERNANCE_VERSION = "runtime-trading-governance-v1";
export type RuntimeState = "RESEARCH" | "FROZEN" | "OUT_OF_SAMPLE" | "DEMO_VALIDATION" | "APPROVED_SHADOW" | "LIVE_LIMITED" | "LIVE_APPROVED" | "REVALIDATION_REQUIRED" | "PAUSED" | "RETIRED" | "REJECTED";
export type RuntimeDecision = "NO_TRADE" | "SHADOW_ONLY" | "LIMITED_ELIGIBLE" | "LIVE_ELIGIBLE";

const transitions: Record<RuntimeState, RuntimeState[]> = {
  RESEARCH: ["FROZEN", "REJECTED", "RETIRED"], FROZEN: ["OUT_OF_SAMPLE", "RESEARCH", "REJECTED"], OUT_OF_SAMPLE: ["DEMO_VALIDATION", "REJECTED", "REVALIDATION_REQUIRED"],
  DEMO_VALIDATION: ["APPROVED_SHADOW", "REJECTED", "REVALIDATION_REQUIRED"], APPROVED_SHADOW: ["LIVE_LIMITED", "REVALIDATION_REQUIRED", "PAUSED"],
  LIVE_LIMITED: ["LIVE_APPROVED", "REVALIDATION_REQUIRED", "PAUSED"], LIVE_APPROVED: ["REVALIDATION_REQUIRED", "PAUSED"], REVALIDATION_REQUIRED: ["PAUSED", "RESEARCH", "RETIRED"],
  PAUSED: ["RESEARCH", "RETIRED"], RETIRED: [], REJECTED: ["RESEARCH", "RETIRED"],
};

export function assertRuntimeTransition(from: RuntimeState, to: RuntimeState) { if (!transitions[from].includes(to)) throw new Error(`INVALID_RUNTIME_TRANSITION:${from}->${to}`); return true; }

export interface RuntimeAssessmentInput {
  strategyId: string; strategyVersion: number; state: RuntimeState; cutoffAt: string;
  validationDecision: "APPROVED" | "REJECTED" | "INSUFFICIENT_DATA";
  setupPresent: boolean | null; invalidationCondition: string | null; invalidated: boolean | null;
  regimeEligible: boolean | null; criticalDataComplete: boolean; portfolioCorrelation: number | null; correlationCoverage: number | null;
  rollingExpectedValueR: number | null; rollingLowerBoundR: number | null; observations: number; minimumObservations: number;
  recentCriticalBugs: number | null; killSwitch: boolean;
}

export function assessRuntime(input: RuntimeAssessmentInput) {
  const gates = [
    gate("KILL_SWITCH", input.killSwitch ? "FAIL" : "PASS", input.killSwitch, false),
    gate("VALIDATED_STRATEGY", input.validationDecision === "INSUFFICIENT_DATA" ? "UNKNOWN" : input.validationDecision === "APPROVED" ? "PASS" : "FAIL", input.validationDecision, "APPROVED"),
    boolGate("SETUP_PRESENT", input.setupPresent, true), boolGate("REGIME_ELIGIBLE", input.regimeEligible, true),
    gate("CRITICAL_DATA_COMPLETE", input.criticalDataComplete ? "PASS" : "UNKNOWN", input.criticalDataComplete, true),
    gate("INVALIDATION_DEFINED", input.invalidationCondition?.trim() ? "PASS" : "UNKNOWN", input.invalidationCondition, "NON_EMPTY"),
    gate("THESIS_NOT_INVALIDATED", input.invalidated === null ? "UNKNOWN" : input.invalidated ? "FAIL" : "PASS", input.invalidated, false),
    numberGate("CORRELATION_COVERAGE", input.correlationCoverage, ">=0.8", (value) => value >= 0.8),
    numberGate("PORTFOLIO_CORRELATION", input.portfolioCorrelation, "<=0.75", (value) => value <= 0.75),
    gate("NO_CRITICAL_BUGS", input.recentCriticalBugs === null ? "UNKNOWN" : input.recentCriticalBugs === 0 ? "PASS" : "FAIL", input.recentCriticalBugs, 0),
  ];
  const decay = assessEdgeDecay(input);
  const stateAllows = input.state === "APPROVED_SHADOW" || input.state === "LIVE_LIMITED" || input.state === "LIVE_APPROVED";
  const allPass = gates.every((item) => item.status === "PASS") && decay.status === "PASS";
  const decision: RuntimeDecision = !allPass || !stateAllows ? "NO_TRADE" : input.state === "APPROVED_SHADOW" ? "SHADOW_ONLY" : input.state === "LIVE_LIMITED" ? "LIMITED_ELIGIBLE" : "LIVE_ELIGIBLE";
  const result = { version: RUNTIME_GOVERNANCE_VERSION, decision, gates, edgeDecay: decay, revalidationRequired: decay.status === "FAIL" || gates.some((item) => ["THESIS_NOT_INVALIDATED", "NO_CRITICAL_BUGS"].includes(item.code) && item.status === "FAIL") };
  return { ...result, assessmentKey: `runtime_${deterministicDigest({ strategyId: input.strategyId, strategyVersion: input.strategyVersion, cutoffAt: input.cutoffAt, version: RUNTIME_GOVERNANCE_VERSION }).slice(0, 40)}`, resultHash: deterministicDigest(result) };
}

export function assessEdgeDecay(input: Pick<RuntimeAssessmentInput, "rollingExpectedValueR" | "rollingLowerBoundR" | "observations" | "minimumObservations">) {
  if (input.observations < input.minimumObservations || input.rollingExpectedValueR === null || input.rollingLowerBoundR === null) return { status: "UNKNOWN" as const, reason: "INSUFFICIENT_RUNTIME_SAMPLE" };
  if (input.rollingExpectedValueR <= 0 || input.rollingLowerBoundR <= 0) return { status: "FAIL" as const, reason: "EDGE_DECAY_DETECTED" };
  return { status: "PASS" as const, reason: null };
}

export function riskOfRuin(winProbability: number | null, averageWinR: number | null, averageLossR: number | null, riskFraction: number | null) {
  if ([winProbability, averageWinR, averageLossR, riskFraction].some((value) => value === null) || winProbability! <= 0 || winProbability! >= 1 || averageWinR! <= 0 || averageLossR! <= 0 || riskFraction! <= 0 || riskFraction! >= 1) return null;
  const edge = winProbability! * averageWinR! - (1 - winProbability!) * averageLossR!;
  if (edge <= 0) return 1;
  const payoff = averageWinR! / averageLossR!;
  const kelly = Math.max(0, Math.min(1, winProbability! - (1 - winProbability!) / payoff));
  if (kelly === 0) return 1;
  return Math.max(0, Math.min(1, Math.exp((-2 * edge) / (riskFraction! * (averageWinR! + averageLossR!) ** 2))));
}

export function fractionalKelly(winProbability: number | null, averageWinR: number | null, averageLossR: number | null, fraction = 0.25, hardCap = 0.02) {
  if (winProbability === null || averageWinR === null || averageLossR === null || averageWinR <= 0 || averageLossR <= 0) return null;
  const full = winProbability - (1 - winProbability) / (averageWinR / averageLossR);
  return Math.max(0, Math.min(hardCap, full * fraction));
}

export function capitalStepRecommendation(currentCapital: number, requestedCapital: number, evidenceStatus: GateStatus, manualApproval: boolean, maximumMultiplier = 2) {
  const allowed = evidenceStatus === "PASS" && manualApproval && requestedCapital > currentCapital && requestedCapital <= currentCapital * maximumMultiplier;
  return { decision: allowed ? "APPROVED" as const : "NO_CHANGE" as const, currentCapital, requestedCapital, maximumAllowed: currentCapital * maximumMultiplier, manualApprovalRequired: true };
}

function gate(code: string, status: GateStatus, observedValue: unknown, requiredValue: unknown) { return { code, status, observedValue, requiredValue, reason: status === "PASS" ? null : `${code}_${status}` }; }
function boolGate(code: string, value: boolean | null, required: boolean) { return gate(code, value === null ? "UNKNOWN" : value === required ? "PASS" : "FAIL", value, required); }
function numberGate(code: string, value: number | null, required: string, predicate: (value: number) => boolean) { return gate(code, value === null || !Number.isFinite(value) ? "UNKNOWN" : predicate(value) ? "PASS" : "FAIL", value, required); }
