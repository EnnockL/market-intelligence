import { deterministicDigest } from "@/domain/events";

export const AGENT_PERFORMANCE_VERSION = "agent-performance-v1";
export const AGENT_PERFORMANCE_MIN_SAMPLE = 30;

export type PerformanceMetric =
  | { status: "VALUE"; value: number }
  | { status: "INSUFFICIENT_DATA"; value: null; reason: string };

export interface AgentEvaluationPoint {
  id: string;
  stance: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
  actualReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  dataQuality: number | null;
  overlapLevels: Array<"LOW" | "MEDIUM" | "HIGH">;
  consensusWithCorrect: boolean | null;
  consensusWithoutCorrect: boolean | null;
}

export function calculateAgentPerformance(points: AgentEvaluationPoint[]) {
  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const directional = ordered.filter((point) => point.stance === "BULLISH" || point.stance === "BEARISH");
  const bullish = ordered.filter((point) => point.stance === "BULLISH");
  const positive = ordered.filter((point) => point.actualReturn > 0);
  const paired = ordered.filter(
    (point) => point.consensusWithCorrect !== null && point.consensusWithoutCorrect !== null,
  );
  const enough = directional.length >= AGENT_PERFORMANCE_MIN_SAMPLE;
  const pairedEnough = paired.length >= AGENT_PERFORMANCE_MIN_SAMPLE;
  const returns = directional.map((point) => point.actualReturn);
  const overlapPenaltyRaw = mean(
    ordered.flatMap((point) => point.overlapLevels.map((level) => ({ LOW: 0, MEDIUM: 0.5, HIGH: 1 })[level])),
  );
  const incrementalRaw = pairedEnough
    ? accuracy(paired, (point) => point.consensusWithCorrect === true) -
      accuracy(paired, (point) => point.consensusWithoutCorrect === true)
    : Number.NaN;
  const metrics = {
    directionalAccuracy: metric(enough, accuracy(directional, directionCorrect), "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED"),
    precision: metric(
      bullish.length >= AGENT_PERFORMANCE_MIN_SAMPLE,
      accuracy(bullish, (point) => point.actualReturn > 0),
      "MINIMUM_BULLISH_SAMPLE_NOT_REACHED",
    ),
    recall: metric(
      positive.length >= AGENT_PERFORMANCE_MIN_SAMPLE,
      accuracy(positive, (point) => point.stance === "BULLISH"),
      "MINIMUM_POSITIVE_SAMPLE_NOT_REACHED",
    ),
    meanReturn: metric(enough, mean(returns), "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED"),
    medianReturn: metric(enough, median(returns), "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED"),
    meanAbsoluteError: insufficient("AGENT_DID_NOT_PUBLISH_NUMERIC_RETURN_FORECAST"),
    maxFavorableExcursion: metric(
      enough,
      mean(directional.map((point) => point.maxFavorableExcursion)),
      "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED",
    ),
    maxAdverseExcursion: metric(
      enough,
      mean(directional.map((point) => point.maxAdverseExcursion)),
      "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED",
    ),
    hitRate: metric(enough, accuracy(directional, directionCorrect), "MINIMUM_DIRECTIONAL_SAMPLE_NOT_REACHED"),
    incrementalValue: metric(pairedEnough, incrementalRaw, "MINIMUM_LEAVE_ONE_OUT_SAMPLE_NOT_REACHED"),
    overlapPenalty: metric(
      enough && Number.isFinite(overlapPenaltyRaw),
      overlapPenaltyRaw * 100,
      "MINIMUM_OVERLAP_SAMPLE_NOT_REACHED",
    ),
    regimeStability: insufficient("MULTIPLE_MARKET_REGIMES_REQUIRED"),
  };
  const independentEdge = !pairedEnough
    ? "NOT_PROVEN"
    : incrementalRaw >= 5 && overlapPenaltyRaw < 0.5
      ? "HIGH"
      : incrementalRaw > 0 && overlapPenaltyRaw < 0.75
        ? "MEDIUM"
        : "LOW";
  const result = {
    status: enough ? ("AVAILABLE" as const) : ("INSUFFICIENT_DATA" as const),
    reason: enough ? null : "MINIMUM_SAMPLE_NOT_REACHED",
    sampleSize: ordered.length,
    directionalSampleSize: directional.length,
    leaveOneOutSampleSize: paired.length,
    independentEdge,
    metrics,
  };
  return { ...result, inputHash: deterministicDigest({ version: AGENT_PERFORMANCE_VERSION, points: ordered }) };
}

export function qualityBucket(value: number | null) {
  if (value === null) return "UNKNOWN";
  if (value < 60) return "LOW";
  if (value < 80) return "MEDIUM";
  return "HIGH";
}

export function consensusDirection(result: string): "BULLISH" | "BEARISH" | null {
  if (result === "MODERATELY_BULLISH") return "BULLISH";
  if (result === "MODERATELY_BEARISH") return "BEARISH";
  return null;
}

function directionCorrect(point: AgentEvaluationPoint) {
  return point.stance === "BULLISH" ? point.actualReturn > 0 : point.actualReturn < 0;
}
function accuracy<T>(values: T[], predicate: (value: T) => boolean) {
  return values.length ? (values.filter(predicate).length / values.length) * 100 : Number.NaN;
}
function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}
function median(values: number[]) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function metric(ok: boolean, value: number, reason: string): PerformanceMetric {
  return ok && Number.isFinite(value) ? { status: "VALUE", value } : insufficient(reason);
}
function insufficient(reason: string): PerformanceMetric {
  return { status: "INSUFFICIENT_DATA", value: null, reason };
}
