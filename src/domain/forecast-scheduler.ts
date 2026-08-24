export const FORECAST_SCHEDULER_VERSION = "forecast-scheduler-v1.4";
export const DEFAULT_SCHEDULER_BATCH_LIMIT = 20;
export const MAX_SCHEDULER_BATCH_LIMIT = 25;
export const DEFAULT_SCHEDULER_RUNTIME_MS = 50_000;
export const MINIMUM_JOB_START_BUDGET_MS = 3_000;
export type ScheduledJobStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "PAUSED";

export function schedulerBatchLimit(value?: number) {
  return Math.max(1, Math.min(MAX_SCHEDULER_BATCH_LIMIT, Number.isFinite(value) ? Math.floor(value!) : DEFAULT_SCHEDULER_BATCH_LIMIT));
}
export function retryDelaySeconds(attempt: number, base = 30, max = 3600) {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}
export function schedulerHasTime(startedAtMs: number, nowMs: number, maxRuntimeMs = DEFAULT_SCHEDULER_RUNTIME_MS, minimumRemainingMs = MINIMUM_JOB_START_BUDGET_MS) {
  return nowMs - startedAtMs + minimumRemainingMs < maxRuntimeMs;
}
export function schedulerCursorOffset(offset: number, received: number, limit: number) {
  return received < limit ? 0 : Math.max(0, offset) + received;
}
export function schedulerError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try { return JSON.stringify(cause); } catch { return "UNKNOWN_SCHEDULER_ERROR"; }
}
export function healthStatus(input: { paused: boolean; consecutiveFailures: number; heartbeatAt: string | null; now: string; leaseSeconds: number }): ScheduledJobStatus {
  if (input.paused) return "PAUSED";
  if (input.consecutiveFailures >= 3) return "FAILED";
  if (input.consecutiveFailures > 0) return "DEGRADED";
  if (input.heartbeatAt && Date.parse(input.now) - Date.parse(input.heartbeatAt) > input.leaseSeconds * 2000) return "DEGRADED";
  return "HEALTHY";
}
