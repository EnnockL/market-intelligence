import { deterministicDigest } from "@/domain/events";

export const MARKET_REGIME_POLICY_VERSION = "market-regime-policy-v1";
export type MarketRegime = "RISK_ON" | "RISK_OFF" | "SIDEWAYS" | "UNKNOWN";
export type RegimeAssetClass = "stock" | "crypto";

export interface RegimeObservationPair {
  assetId: string;
  currentPrice: number;
  baselinePrice: number;
  currentObservedAt: string;
  baselineObservedAt: string;
  evidenceRefs: string[];
}

export const REGIME_POLICY = {
  version: MARKET_REGIME_POLICY_VERSION,
  minimumAssets: 3,
  minimumCoveragePct: 60,
  stock: { lookbackMs: 5 * 86_400_000, staleAfterMs: 3 * 86_400_000, trendThresholdPct: 0.5, sidewaysDispersionPct: 2 },
  crypto: { lookbackMs: 24 * 3_600_000, staleAfterMs: 45 * 60_000, trendThresholdPct: 2, sidewaysDispersionPct: 5 },
} as const;

export function classifyMarketRegime(input: {
  assetClass: RegimeAssetClass;
  evaluatedAt: string;
  expectedAssets: number;
  observations: RegimeObservationPair[];
}) {
  const policy = REGIME_POLICY[input.assetClass];
  const ordered = [...input.observations].sort((a, b) => a.assetId.localeCompare(b.assetId));
  const usable = ordered.filter(
    (row) => row.currentPrice > 0 && row.baselinePrice > 0 && row.currentObservedAt <= input.evaluatedAt,
  );
  const fresh = usable.filter(
    (row) => Date.parse(input.evaluatedAt) - Date.parse(row.currentObservedAt) <= policy.staleAfterMs,
  );
  const expected = Math.max(0, input.expectedAssets);
  const coveragePct = expected ? (fresh.length / expected) * 100 : 0;
  const returns = fresh.map((row) => (row.currentPrice / row.baselinePrice - 1) * 100);
  const medianReturnPct = median(returns);
  const positiveBreadthPct = returns.length ? (returns.filter((value) => value > 0).length / returns.length) * 100 : null;
  const dispersionPct = returns.length ? mean(returns.map((value) => Math.abs(value - medianReturnPct!))) : null;
  const sufficient = fresh.length >= REGIME_POLICY.minimumAssets && coveragePct >= REGIME_POLICY.minimumCoveragePct;
  let regime: MarketRegime = "UNKNOWN";
  let reason: string | null = null;
  if (!sufficient) reason = fresh.length < REGIME_POLICY.minimumAssets ? "MINIMUM_ASSET_SAMPLE_NOT_REACHED" : "COVERAGE_BELOW_THRESHOLD";
  else if (medianReturnPct! >= policy.trendThresholdPct && positiveBreadthPct! >= 60) regime = "RISK_ON";
  else if (medianReturnPct! <= -policy.trendThresholdPct && positiveBreadthPct! <= 40) regime = "RISK_OFF";
  else if (Math.abs(medianReturnPct!) < policy.trendThresholdPct && dispersionPct! <= policy.sidewaysDispersionPct) regime = "SIDEWAYS";
  else reason = "MIXED_MARKET_EVIDENCE";
  const dataQuality = sufficient ? Math.round(Math.min(100, coveragePct)) : null;
  const result = {
    policyVersion: MARKET_REGIME_POLICY_VERSION,
    assetClass: input.assetClass,
    regime,
    reason,
    sampleSize: fresh.length,
    expectedAssets: expected,
    coveragePct,
    medianReturnPct,
    positiveBreadthPct,
    dispersionPct,
    dataQuality,
    confidence: regime === "UNKNOWN" ? null : dataQuality,
    evidenceRefs: [...new Set(fresh.flatMap((row) => row.evidenceRefs))].sort(),
  };
  return { ...result, resultHash: deterministicDigest({ result, observations: fresh }) };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
