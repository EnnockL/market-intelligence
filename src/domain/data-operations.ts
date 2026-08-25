export type OperationsStatus = "LIVE" | "STALE" | "DEGRADED" | "UNAVAILABLE";

export interface FreshnessInput { lastSuccessAt: string | null; latestStatus?: string | null; freshnessSeconds: number; now?: Date }

export function classifyOperationsStatus(input: FreshnessInput): OperationsStatus {
  if (!input.lastSuccessAt) return "UNAVAILABLE";
  if (input.latestStatus === "failed" || input.latestStatus === "FAILED") return "DEGRADED";
  const age = (input.now ?? new Date()).getTime() - new Date(input.lastSuccessAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "DEGRADED";
  return age <= input.freshnessSeconds * 1000 ? "LIVE" : "STALE";
}

export function ageLabel(value: string | null, now = new Date()) {
  if (!value) return "No successful observation";
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export const SAFE_MANUAL_JOB_TYPES = new Set(["STOCK_INGESTION", "WALLET_INGESTION", "WALLET_DISCOVERY", "CRYPTO_MARKET", "POOL_DISCOVERY", "CANDLE_INGESTION", "NEWS_INGESTION"]);
