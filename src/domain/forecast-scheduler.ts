export const FORECAST_SCHEDULER_VERSION = "forecast-scheduler-v1.3";
export const DEFAULT_SCHEDULER_BATCH_LIMIT = 20;
export const MAX_SCHEDULER_BATCH_LIMIT = 25;
export type ScheduledJobStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "PAUSED";

export function schedulerBatchLimit(value?: number) {
  return Math.max(1, Math.min(MAX_SCHEDULER_BATCH_LIMIT, Number.isFinite(value) ? Math.floor(value!) : DEFAULT_SCHEDULER_BATCH_LIMIT));
}
export function retryDelaySeconds(attempt: number, base = 30, max = 3600) {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}
export function healthStatus(input: { paused: boolean; consecutiveFailures: number; heartbeatAt: string | null; now: string; leaseSeconds: number }): ScheduledJobStatus {
  if (input.paused) return "PAUSED";
  if (input.consecutiveFailures >= 3) return "FAILED";
  if (input.consecutiveFailures > 0) return "DEGRADED";
  if (input.heartbeatAt && Date.parse(input.now) - Date.parse(input.heartbeatAt) > input.leaseSeconds * 2000) return "DEGRADED";
  return "HEALTHY";
}
