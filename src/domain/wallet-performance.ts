import type { TradeCycle } from "./wallet-pnl";
export const PERFORMANCE_CURVE_VERSION = "realized-pnl-curve-v1" as const;
export interface PerformancePoint { timestamp: string; tradeCycleId: string; cumulativeRealizedPnlUsd: number; cumulativeReturn: number; equityIndex: number; }
export interface DrawdownResult { status: "available" | "insufficient_data"; maxDrawdownPercent: number | null; maxDrawdownUsd: number | null; startAt: string | null; bottomAt: string | null; recoveredAt: string | null; }

export function buildRealizedPnlCurve(cycles: Array<TradeCycle & { id?: string }>): PerformancePoint[] {
  const verified = cycles.filter((item) => item.dataQuality === 100 && item.finalExitAt && item.realizedPnlUsd !== null && item.returnPercent !== null)
    .sort((a, b) => a.finalExitAt!.localeCompare(b.finalExitAt!) || a.cycleNumber - b.cycleNumber);
  let pnl = 0; let equity = 1;
  return verified.map((cycle) => { pnl += cycle.realizedPnlUsd!; equity *= Math.max(0, 1 + cycle.returnPercent! / 100); return { timestamp: cycle.finalExitAt!, tradeCycleId: cycle.id ?? `${cycle.token}:${cycle.cycleNumber}`, cumulativeRealizedPnlUsd: pnl, cumulativeReturn: equity - 1, equityIndex: equity }; });
}

export function calculateDrawdown(points: PerformancePoint[]): DrawdownResult {
  if (points.length < 2) return { status: "insufficient_data", maxDrawdownPercent: null, maxDrawdownUsd: null, startAt: null, bottomAt: null, recoveredAt: null };
  let peakEquity = 1; let peakPnl = 0; let peakAt = points[0].timestamp; let worstPeakAt = peakAt; let worstPeakEquity = 1; let worstBottom = 0; let maximum = 0; let worstUsd = 0;
  for (let index = 0; index < points.length; index++) { const point = points[index]; if (point.equityIndex > peakEquity) { peakEquity = point.equityIndex; peakPnl = point.cumulativeRealizedPnlUsd; peakAt = point.timestamp; } const dd = (peakEquity - point.equityIndex) / peakEquity; if (dd > maximum) { maximum = dd; worstPeakAt = peakAt; worstPeakEquity = peakEquity; worstBottom = index; worstUsd = Math.max(0, peakPnl - point.cumulativeRealizedPnlUsd); } }
  let recoveredAt: string | null = null; for (let index = worstBottom + 1; index < points.length; index++) if (points[index].equityIndex >= worstPeakEquity) { recoveredAt = points[index].timestamp; break; }
  return { status: "available", maxDrawdownPercent: maximum, maxDrawdownUsd: worstUsd, startAt: worstPeakAt, bottomAt: points[worstBottom].timestamp, recoveredAt };
}
