import { deterministicDigest } from "./events";

export const STRATEGY_RESEARCH_CYCLE_VERSION = "strategy-research-cycle-v1";

export type ResearchCycleStatus =
  | "COLLECTING"
  | "READY_FOR_VALIDATION"
  | "REJECTED"
  | "INSUFFICIENT_DATA";

export interface ResearchCycleInput {
  strategyDefinitionId: string;
  hypothesisId: string | null;
  evaluationRunId: string | null;
  evaluationStatus: "AVAILABLE" | "INSUFFICIENT_DATA" | null;
  lifecycleState: string | null;
  tradeCount: number;
  setupCount: number;
  minimumSampleSize: number;
  cutoffAt: string;
}

export function evaluateResearchCycle(input: ResearchCycleInput) {
  const blockers: string[] = [];
  if (!input.hypothesisId) blockers.push("HYPOTHESIS_MISSING");
  if (!input.evaluationRunId) blockers.push("EVALUATION_MISSING");
  if (input.tradeCount < input.minimumSampleSize)
    blockers.push("MINIMUM_SAMPLE_NOT_REACHED");

  const status: ResearchCycleStatus =
    input.lifecycleState === "REJECTED"
      ? "REJECTED"
      : !input.evaluationRunId || input.evaluationStatus === null
        ? "INSUFFICIENT_DATA"
        : input.evaluationStatus === "AVAILABLE" && !blockers.length
          ? "READY_FOR_VALIDATION"
          : "COLLECTING";
  const result = {
    cycleVersion: STRATEGY_RESEARCH_CYCLE_VERSION,
    status,
    blockers,
    progress: {
      setups: input.setupCount,
      trades: input.tradeCount,
      requiredTrades: input.minimumSampleSize,
    },
  };
  const identity = {
    strategyDefinitionId: input.strategyDefinitionId,
    hypothesisId: input.hypothesisId,
    evaluationRunId: input.evaluationRunId,
    lifecycleState: input.lifecycleState,
    cycleVersion: STRATEGY_RESEARCH_CYCLE_VERSION,
  };
  return {
    ...result,
    cycleKey: `research_cycle_${deterministicDigest(identity).slice(0, 40)}`,
    resultHash: deterministicDigest(result),
  };
}
