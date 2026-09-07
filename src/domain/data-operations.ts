export type OperationsStatus = "LIVE" | "STALE" | "DEGRADED" | "UNAVAILABLE" | "PAUSED";

export interface FreshnessInput { lastSuccessAt: string | null; latestStatus?: string | null; freshnessSeconds: number; now?: Date }

export function classifyOperationsStatus(input: FreshnessInput): OperationsStatus {
  if (["failed", "FAILED", "DEGRADED"].includes(input.latestStatus ?? "")) return "DEGRADED";
  if (!input.lastSuccessAt) return "UNAVAILABLE";
  const age = (input.now ?? new Date()).getTime() - new Date(input.lastSuccessAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "DEGRADED";
  return age <= input.freshnessSeconds * 1000 ? "LIVE" : "STALE";
}

export function pipelineReadStatus(job: { enabled: boolean; status: string; last_successful_run_at: string | null; interval_seconds: number }, now = new Date()): OperationsStatus {
  if (!job.enabled) return "PAUSED";
  return classifyOperationsStatus({ lastSuccessAt: job.last_successful_run_at, latestStatus: job.status,
    freshnessSeconds: Math.max(60, job.interval_seconds * 2), now });
}

export function processedRecordCount(metrics?: Record<string, unknown>): number | null {
  const value = metrics?.records ?? metrics?.processed ?? metrics?.recordsProcessed ?? metrics?.records_processed;
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function ageLabel(value: string | null, now = new Date()) {
  if (!value) return "No successful observation";
  const age = now.getTime() - new Date(value).getTime();
  if (!Number.isFinite(age)) return "Invalid timestamp";
  if (age < 0) return "Future timestamp — check clock";
  const seconds = Math.floor(age / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export const SAFE_MANUAL_JOB_TYPES = new Set(["STOCK_INGESTION", "WALLET_INGESTION", "WALLET_DISCOVERY", "CRYPTO_MARKET", "POOL_DISCOVERY", "CANDLE_INGESTION", "NEWS_INGESTION"]);
