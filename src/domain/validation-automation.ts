import { deterministicDigest } from "./events";
import type { ValidationPhase } from "./strategy-validation";

export const VALIDATION_WINDOW_PLANNER_VERSION = "validation-window-planner-v1";
export const SHADOW_TRACKING_VERSION = "strategy-shadow-tracking-v1";
export const VALIDATION_PHASES: ValidationPhase[] = [
  "LEARNING",
  "FROZEN",
  "OUT_OF_SAMPLE",
  "DEMO_VALIDATION",
];

export interface EvaluationWindow {
  id: string;
  startsAt: string;
  endsAt: string;
  availableAt: string;
  tradeCount: number;
}

export function nextValidationWindow(input: {
  strategyDefinitionId: string;
  hypothesisId: string;
  registeredAt: string;
  cutoffAt: string;
  runs: EvaluationWindow[];
  completed: Array<{
    phase: ValidationPhase;
    decision: string;
    windowEnd: string;
  }>;
}) {
  const ordered = [...input.runs]
    .filter((r) => r.availableAt <= input.cutoffAt && r.startsAt <= r.endsAt)
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  const completed = new Map(input.completed.map((row) => [row.phase, row]));
  const phase =
    VALIDATION_PHASES.find((value) => !completed.has(value)) ?? null;
  if (!phase)
    return decision("COMPLETED", null, [], "ALL_PHASES_RECORDED", input);
  const index = VALIDATION_PHASES.indexOf(phase),
    previous = index ? completed.get(VALIDATION_PHASES[index - 1]) : null;
  if (previous && previous.decision !== "APPROVED")
    return decision(
      "BLOCKED",
      phase,
      [],
      `PREVIOUS_PHASE_${previous.decision}`,
      input,
    );
  const eligible = ordered.filter(
    (run) =>
      (!previous || run.startsAt > previous.windowEnd) &&
      (phase === "LEARNING" || run.startsAt >= input.registeredAt),
  );
  if (!eligible.length)
    return decision(
      "INSUFFICIENT_DATA",
      phase,
      [],
      phase === "LEARNING"
        ? "NO_AVAILABLE_EVALUATION_WINDOW"
        : "NO_NON_OVERLAPPING_POST_FREEZE_WINDOW",
      input,
    );
  return decision("READY", phase, [eligible[0].id], null, input, eligible[0]);
}

function decision(
  status: string,
  phase: ValidationPhase | null,
  ids: string[],
  reason: string | null,
  input: { strategyDefinitionId: string; hypothesisId: string },
  window?: EvaluationWindow,
) {
  const body = {
    plannerVersion: VALIDATION_WINDOW_PLANNER_VERSION,
    status,
    phase,
    evaluationRunIds: ids,
    reason,
    windowStart: window?.startsAt ?? null,
    windowEnd: window?.endsAt ?? null,
  };
  const identity = {
    ...body,
    strategyDefinitionId: input.strategyDefinitionId,
    hypothesisId: input.hypothesisId,
  };
  return {
    ...body,
    planKey: `window_${deterministicDigest(identity).slice(0, 40)}`,
    planHash: deterministicDigest(body),
  };
}

export function shadowObservation(input: {
  strategyDefinitionId: string;
  runtimeAssessmentId: string;
  mode: "SHADOW" | "DEMO";
  cutoffAt: string;
  bucketStartedAt: string;
  globalCounts: {
    proposals: number;
    intents: number;
    orders: number;
    fills: number;
    rejected: number;
  };
  strategyCounts?: { proposals:number;intents:number;orders:number;fills:number };
}) {
  const attributionStatus = input.strategyCounts ? "KNOWN" as const : "UNKNOWN" as const;
  const metrics = {
    ...input.globalCounts,
    attributableProposals: input.strategyCounts?.proposals??null,
    attributableIntents: input.strategyCounts?.intents??null,
    attributableOrders: input.strategyCounts?.orders??null,
    attributableFills: input.strategyCounts?.fills??null,
  };
  const body = {
    trackingVersion: SHADOW_TRACKING_VERSION,
    mode: input.mode,
    attributionStatus,
    metrics,
  };
  return {
    ...body,
    observationKey: `shadow_${deterministicDigest({ strategyDefinitionId: input.strategyDefinitionId, runtimeAssessmentId: input.runtimeAssessmentId, bucketStartedAt: input.bucketStartedAt, version: SHADOW_TRACKING_VERSION }).slice(0, 40)}`,
    resultHash: deterministicDigest(body),
  };
}
