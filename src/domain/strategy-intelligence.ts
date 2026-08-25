import { deterministicDigest } from "./events";
import type { StrategyTrade } from "./strategy-pattern-lab";

export const STRATEGY_RESEARCH_VERSION = "strategy-research-v1";
export const STRATEGY_SELECTOR_VERSION = "strategy-selector-v1";
export type ResearchSplit = "TRAIN" | "VALIDATION" | "OUT_OF_SAMPLE";
export type IntelligenceStatus = "AVAILABLE" | "INSUFFICIENT_DATA";

export interface StrategyResearchInput {
  strategyId: string; strategyVersion: number; evaluationRunId: string; assetId: string; asset: string; assetClass: string;
  market: string; timeframe: string; windowStart: string; windowEnd: string; informationCutoffAt: string;
  session: string; regime: string; split: ResearchSplit; minimumSampleSize: number; setupCount?: number; dataQuality: number | null; trades: StrategyTrade[];
}
export interface StrategyPerformanceSnapshot {
  snapshotKey: string; performanceVersion: string; datasetHash: string; status: IntelligenceStatus; reason: string | null;
  strategyId: string; strategyVersion: number; evaluationRunId: string; assetId: string; asset: string; assetClass: string;
  market: string; timeframe: string; windowStart: string; windowEnd: string; informationCutoffAt: string; session: string; regime: string;
  split: ResearchSplit; sampleSize: number; setupCount: number; tradeCount: number; metrics: Record<string, number | null>;
  segments: Array<{ dimension: string; value: string; sampleSize: number; status: IntelligenceStatus; expectedValueR: number | null; winRate: number | null }>;
  dataQuality: number | null;
}

export function buildStrategyPerformanceSnapshot(input: StrategyResearchInput): StrategyPerformanceSnapshot {
  const trades = [...input.trades].filter(item => item.enteredAt >= input.windowStart && item.exitedAt <= input.windowEnd && item.exitedAt <= input.informationCutoffAt).sort((a, b) => a.enteredAt.localeCompare(b.enteredAt) || a.tradeKey.localeCompare(b.tradeKey));
  const datasetHash = deterministicDigest(trades.map(item => ({ key: item.tradeKey, exit: item.exitedAt, r: item.rMultiple, refs: item.evidenceRefs })));
  const enough = trades.length >= input.minimumSampleSize;
  const raw = researchMetrics(trades);
  const metrics = enough ? raw : Object.fromEntries(Object.keys(raw).map(key => [key, null]));
  const segments = researchSegments(trades, input.minimumSampleSize, input);
  const identity = { version: STRATEGY_RESEARCH_VERSION, strategyId: input.strategyId, strategyVersion: input.strategyVersion, evaluationRunId: input.evaluationRunId, windowStart: input.windowStart, windowEnd: input.windowEnd, informationCutoffAt: input.informationCutoffAt, split: input.split, datasetHash };
  return { snapshotKey: deterministicDigest(identity), performanceVersion: STRATEGY_RESEARCH_VERSION, datasetHash, status: enough ? "AVAILABLE" : "INSUFFICIENT_DATA", reason: enough ? null : "MINIMUM_SAMPLE_SIZE_NOT_MET", strategyId: input.strategyId, strategyVersion: input.strategyVersion, evaluationRunId: input.evaluationRunId, assetId: input.assetId, asset: input.asset, assetClass: input.assetClass, market: input.market, timeframe: input.timeframe, windowStart: input.windowStart, windowEnd: input.windowEnd, informationCutoffAt: input.informationCutoffAt, session: input.session, regime: input.regime, split: input.split, sampleSize: trades.length, setupCount: input.setupCount ?? trades.length, tradeCount: trades.length, metrics, segments, dataQuality: input.dataQuality };
}

function researchMetrics(trades: StrategyTrade[]) {
  const values = trades.map(item => item.rMultiple), wins = values.filter(value => value > 0), losses = values.filter(value => value < 0);
  let equity = 0, peak = 0; const drawdowns: number[] = [];
  for (const value of values) { equity += value; peak = Math.max(peak, equity); drawdowns.push(equity - peak); }
  return {
    winRate: values.length ? wins.length / values.length * 100 : null, lossRate: values.length ? losses.length / values.length * 100 : null,
    profitFactor: losses.length ? wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0)) : null,
    expectedValueR: values.length ? average(values) : null, averageReturnR: values.length ? average(values) : null, medianReturnR: values.length ? median(values) : null,
    averageR: values.length ? average(values) : null, averageMfeR: trades.length ? average(trades.map(item => item.mfeR)) : null,
    averageMaeR: trades.length ? average(trades.map(item => item.maeR)) : null, maxDrawdownR: drawdowns.length ? Math.min(...drawdowns) : null,
    averageDrawdownR: drawdowns.length ? average(drawdowns) : null, averageHoldMinutes: trades.length ? average(trades.map(item => item.holdMinutes)) : null,
    fees: null, slippage: null,
  };
}

function researchSegments(trades: StrategyTrade[], minimum: number, input: StrategyResearchInput) {
  const dimensions = ["asset", "assetClass", "timeframe", "weekday", "entryHour", "session", "regime", "volatilityBucket", "liquidityBucket"];
  return dimensions.flatMap(dimension => {
    const valueOf = (trade: StrategyTrade) => dimension === "asset" ? input.asset : dimension === "assetClass" ? input.assetClass : dimension === "timeframe" ? input.timeframe : dimension === "weekday" ? trade.weekday : dimension === "entryHour" ? trade.entryHour : dimension === "session" ? trade.session : dimension === "regime" ? trade.regime : dimension === "volatilityBucket" ? trade.volatilityBucket : "UNKNOWN";
    return [...new Set(trades.map(valueOf))].sort().map(value => { const group = trades.filter(item => valueOf(item) === value), enough = group.length >= minimum; return { dimension, value, sampleSize: group.length, status: enough ? "AVAILABLE" as const : "INSUFFICIENT_DATA" as const, expectedValueR: enough ? average(group.map(item => item.rMultiple)) : null, winRate: enough ? group.filter(item => item.rMultiple > 0).length / group.length * 100 : null }; });
  });
}

export interface StrategySelectorContext { assetId: string; asset: string; assetClass: string; timeframe: string; session: string; regime: string; volatilityBucket: string; liquidityBucket: string; cutoffAt: string; minimumSampleSize: number; }
export interface RankedStrategy { strategyId: string; strategyVersion: number; snapshotKey: string; status: "ELIGIBLE" | "POOR_FIT" | "INSUFFICIENT_DATA"; fitScore: number | null; sampleSize: number; metrics: Record<string, number | null>; evidenceQuality: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; reasons: string[]; }

export function selectStrategies(context: StrategySelectorContext, source: StrategyPerformanceSnapshot[]) {
  const eligibleSnapshots = source.filter(item => item.assetId === context.assetId && item.timeframe === context.timeframe && item.informationCutoffAt <= context.cutoffAt && item.split !== "TRAIN").sort((a, b) => b.informationCutoffAt.localeCompare(a.informationCutoffAt) || b.snapshotKey.localeCompare(a.snapshotKey));
  const snapshots = [...new Map(eligibleSnapshots.map(item => [`${item.strategyId}:${item.strategyVersion}`, item])).values()].sort((a, b) => a.strategyId.localeCompare(b.strategyId) || a.strategyVersion - b.strategyVersion);
  const ranked: RankedStrategy[] = snapshots.map(item => rankSnapshot(context, item)).sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.strategyId.localeCompare(b.strategyId));
  const eligible = ranked.filter(item => item.status === "ELIGIBLE");
  const result = { selectorVersion: STRATEGY_SELECTOR_VERSION, context, status: eligible.length ? "RANKED" as const : "NO_STRATEGY_ELIGIBLE" as const, rankedStrategies: ranked, selectedStrategy: eligible[0] ?? null };
  return { ...result, resultHash: deterministicDigest(result) };
}

function rankSnapshot(context: StrategySelectorContext, item: StrategyPerformanceSnapshot): RankedStrategy {
  const reasons: string[] = [];
  if (item.status !== "AVAILABLE" || item.sampleSize < context.minimumSampleSize) reasons.push("INSUFFICIENT_SAMPLE");
  const ev = item.metrics.expectedValueR, pf = item.metrics.profitFactor, drawdown = item.metrics.maxDrawdownR;
  if (ev === null || pf === null || drawdown === null) reasons.push("METRICS_UNAVAILABLE");
  if (ev !== null && ev <= 0) reasons.push("NON_POSITIVE_EXPECTED_VALUE");
  if (pf !== null && pf <= 1) reasons.push("PROFIT_FACTOR_NOT_PROVEN");
  const hardBlocked = reasons.includes("INSUFFICIENT_SAMPLE") || reasons.includes("METRICS_UNAVAILABLE");
  if (hardBlocked) return { strategyId: item.strategyId, strategyVersion: item.strategyVersion, snapshotKey: item.snapshotKey, status: "INSUFFICIENT_DATA", fitScore: null, sampleSize: item.sampleSize, metrics: item.metrics, evidenceQuality: quality(item.dataQuality), reasons };
  const positiveEdge = ev! > 0 && pf! > 1;
  const score = clamp(ev! / 0.5 * 25, 0, 25) + clamp((pf! - 1) * 20, 0, 20) + clamp(15 - Math.abs(drawdown!) / 10 * 15, 0, 15) + clamp(item.sampleSize / 200 * 15, 0, 15) + (item.regime === context.regime ? 8 : item.regime === "UNKNOWN" ? 3 : 0) + (item.session === context.session ? 7 : item.session === "UNKNOWN" ? 3 : 0) + (item.dataQuality === null ? 2 : item.dataQuality / 100 * 10);
  return { strategyId: item.strategyId, strategyVersion: item.strategyVersion, snapshotKey: item.snapshotKey, status: positiveEdge ? "ELIGIBLE" : "POOR_FIT", fitScore: Math.round(score * 100) / 100, sampleSize: item.sampleSize, metrics: item.metrics, evidenceQuality: quality(item.dataQuality), reasons };
}

function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)); }
function quality(value: number | null): RankedStrategy["evidenceQuality"] { return value === null ? "UNKNOWN" : value >= 80 ? "HIGH" : value >= 60 ? "MEDIUM" : "LOW"; }
