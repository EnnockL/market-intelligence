export const LIQUIDITY_SELECTION_VERSION = "latest-effective-highest-liquidity-v1" as const;
export interface LiquiditySnapshot { id: string; assetId: string; poolAddress: string | null; liquidityUsd: number; effectiveAt: string; informationAvailableAt: string; provider: string; quality: number; }
export interface LiquiditySelection { snapshot: LiquiditySnapshot | null; status: "available" | "missing"; }
export type CapacityRisk = "LOW" | "MEDIUM" | "HIGH" | "EXTREME" | "UNKNOWN";

export function liquiditySnapshotFromObservation(input: {
  assetId: string; poolAddress: string | null; liquidityUsd: number | null; observedAt: string;
  provider: string; confidence: number;
}): LiquiditySnapshot | null {
  if (!input.poolAddress || input.liquidityUsd === null || !Number.isFinite(input.liquidityUsd) || input.liquidityUsd < 0) return null;
  const effectiveAt = new Date(input.observedAt).toISOString();
  return { id: `${input.assetId}:${input.provider}:${input.poolAddress}:${effectiveAt}`, assetId: input.assetId,
    poolAddress: input.poolAddress, liquidityUsd: input.liquidityUsd, effectiveAt, informationAvailableAt: effectiveAt,
    provider: `${input.provider}-forward-observation`, quality: Math.max(0, Math.min(100, Math.round(input.confidence))) };
}

export function selectPointInTimeLiquidity(snapshots: LiquiditySnapshot[], assetId: string, timestamp: string, cutoff = timestamp): LiquiditySelection {
  const eligible = snapshots.filter((item) => item.assetId === assetId && item.effectiveAt <= timestamp && item.informationAvailableAt <= cutoff && item.liquidityUsd >= 0);
  eligible.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt) || b.liquidityUsd - a.liquidityUsd || (a.poolAddress ?? "").localeCompare(b.poolAddress ?? "") || a.id.localeCompare(b.id));
  return { snapshot: eligible[0] ?? null, status: eligible.length ? "available" : "missing" };
}

export function classifyExecutionCapacity(positionValueUsd: number | null, liquidityUsd: number | null) {
  if (positionValueUsd === null || liquidityUsd === null || liquidityUsd <= 0) return { ratio: null, risk: "UNKNOWN" as CapacityRisk };
  const ratio = positionValueUsd / liquidityUsd;
  const risk: CapacityRisk = ratio <= .005 ? "LOW" : ratio <= .02 ? "MEDIUM" : ratio <= .05 ? "HIGH" : "EXTREME";
  return { ratio, risk };
}
