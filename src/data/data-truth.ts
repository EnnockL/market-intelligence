export type DataMode = "live" | "stale" | "degraded" | "unavailable";

export const LIVE_WINDOW_MS = 15 * 60_000;

export function dataModeAt(
  observedAt: string | null | undefined,
  now = Date.now(),
): "live" | "stale" | "unavailable" {
  if (!observedAt) return "unavailable";
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return "unavailable";
  return now - timestamp <= LIVE_WINDOW_MS ? "live" : "stale";
}

export function latestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter(
    (value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)),
  );
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
