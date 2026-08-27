import { deterministicDigest } from "./events";

export const STRATEGY_CANDIDATE_TRIAGE_VERSION = "strategy-candidate-triage-v1";
export const STRATEGY_CANDIDATE_TRIAGE_POLICY = Object.freeze({
  minimumTrades: 30,
  minimumCandlesPerAsset: 1_000,
  minimumAssets: 2,
  minimumProfitFactor: 1,
  minimumExpectedValueR: 0,
});

export type TriageRecommendation =
  | "PRIORITIZE"
  | "COLLECT_MORE_DATA"
  | "DO_NOT_PRIORITIZE"
  | "EXCLUDED_REJECTED";

export interface TriageRunInput {
  runId: string;
  assetId: string;
  candleCount: number;
  trades: Array<{ tradeKey: string; rMultiple: number }>;
}

export function evaluateStrategyCandidate(input: {
  strategyDefinitionId: string;
  lifecycleState: string | null;
  runs: TriageRunInput[];
  cutoffAt: string;
}) {
  const eligibleRuns = input.runs.filter(
    (run) => run.candleCount >= STRATEGY_CANDIDATE_TRIAGE_POLICY.minimumCandlesPerAsset,
  );
  const trades = deduplicateTrades(eligibleRuns.flatMap((run) =>
    run.trades.map((trade) => ({ ...trade, tradeKey: `${run.assetId}:${trade.tradeKey}` })),
  ));
  const values = trades.map((trade) => trade.rMultiple);
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const expectedValueR = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const profitFactor = losses > 0 ? wins / losses : values.length && wins > 0 ? null : 0;
  const assetCount = new Set(eligibleRuns.map((run) => run.assetId)).size;
  const blockers: string[] = [];
  if (values.length < STRATEGY_CANDIDATE_TRIAGE_POLICY.minimumTrades) blockers.push("SAMPLE_INSUFFICIENT");
  if (assetCount < STRATEGY_CANDIDATE_TRIAGE_POLICY.minimumAssets) blockers.push("ASSET_COVERAGE_INSUFFICIENT");
  if (expectedValueR === null) blockers.push("EXPECTED_VALUE_UNKNOWN");
  else if (expectedValueR <= STRATEGY_CANDIDATE_TRIAGE_POLICY.minimumExpectedValueR) blockers.push("EXPECTED_VALUE_NOT_POSITIVE");
  if (profitFactor === null) blockers.push("PROFIT_FACTOR_UNKNOWN");
  else if (profitFactor <= STRATEGY_CANDIDATE_TRIAGE_POLICY.minimumProfitFactor) blockers.push("PROFIT_FACTOR_NOT_ABOVE_ONE");

  const recommendation: TriageRecommendation =
    input.lifecycleState === "REJECTED"
      ? "EXCLUDED_REJECTED"
      : blockers.some((blocker) => blocker === "EXPECTED_VALUE_NOT_POSITIVE" || blocker === "PROFIT_FACTOR_NOT_ABOVE_ONE")
        ? "DO_NOT_PRIORITIZE"
        : blockers.length
          ? "COLLECT_MORE_DATA"
          : "PRIORITIZE";
  const result = {
    triageVersion: STRATEGY_CANDIDATE_TRIAGE_VERSION,
    recommendation,
    blockers,
    metrics: { tradeCount: values.length, assetCount, expectedValueR, profitFactor },
    inputEvaluationRunIds: eligibleRuns.map((run) => run.runId).sort(),
  };
  const identity = {
    strategyDefinitionId: input.strategyDefinitionId,
    lifecycleState: input.lifecycleState,
    triageVersion: STRATEGY_CANDIDATE_TRIAGE_VERSION,
    inputEvaluationRunIds: result.inputEvaluationRunIds,
  };
  return {
    ...result,
    triageKey: `strategy_triage_${deterministicDigest(identity).slice(0, 40)}`,
    resultHash: deterministicDigest(result),
  };
}

function deduplicateTrades(trades: Array<{ tradeKey: string; rMultiple: number }>) {
  return [...new Map([...trades].sort((a, b) => a.tradeKey.localeCompare(b.tradeKey)).map((trade) => [trade.tradeKey, trade])).values()];
}
