/** Serializable UI state. It never authorizes or runs a strategy. */
export interface LabFormValues { definitionId: string; assetId: string; startsAt: string; endsAt: string; sourceId: string }
export interface LabTrade { trade_key: string; entered_at: string; exited_at: string; r_multiple: number; side: string }
export interface LabRunResult {
  id: string; assetId: string; symbol: string; definitionId: string; strategyName: string;
  timeframe: string; version: string; cutoffAt: string; createdAt: string; status: string;
  candleCount: number; setupCount: number; tradeCount: number; minimumSampleSize: number;
  trades: LabTrade[] | null;
}
export type LabResultRead = { status: "ready" | "empty" | "unavailable"; run: LabRunResult | null };
export type LabSearch = Record<string, string | string[] | undefined>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isLabRunId(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
export function requestedLabRun(search: LabSearch): string | null {
  if (search.run === undefined) return null;
  return typeof search.run === "string" && isLabRunId(search.run) ? search.run : "invalid";
}
export function initialLabValues(search: LabSearch, defaults: LabFormValues): LabFormValues {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = search[key];
    // An explicit empty/invalid date remains empty, never silently becomes today's date.
    if (value === undefined) return [key, fallback];
    if (typeof value !== "string") return [key, ""];
    if (key === "startsAt" || key === "endsAt") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      return [key, date ? value : ""];
    }
    return [key, isLabRunId(value) ? value : ""];
  })) as unknown as LabFormValues;
}
export function labWorkspaceUrl(values: LabFormValues, runId: string | null) {
  const query = new URLSearchParams(values as unknown as Record<string, string>);
  if (runId !== null) query.set("run", isLabRunId(runId) ? runId : "invalid");
  return `/strategy-lab?${query.toString()}`;
}

/** Never substitute a global latest run while an exact result is loading or missing. */
export function resolveLabResult(expectedRunId: string | null, serverRunId: string | null, read: LabResultRead, pending: boolean, failed: boolean) {
  if (pending) return { status: "running" as const, run: null };
  if (failed) return { status: "failed" as const, run: null };
  if (!expectedRunId) return { status: "empty" as const, run: null };
  if (expectedRunId !== serverRunId) return { status: "loading" as const, run: null };
  if (read.status !== "ready" || read.run?.id !== expectedRunId) return { status: "unavailable" as const, run: null };
  return { status: "ready" as const, run: read.run };
}

export function mapLabRun(row: any): LabRunResult | null {
  if (!row || !isLabRunId(row.id)) return null;
  const counts = [row.candle_count, row.setup_count, row.trade_count, row.minimum_sample_size];
  if (counts.some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) return null;
  const rawTrades = row.strategy_evaluation_trades;
  const seen = new Set<string>();
  const tradesValid = Array.isArray(rawTrades) && rawTrades.length === row.trade_count && rawTrades.every(trade => {
    const r = typeof trade.r_multiple === "number" ? trade.r_multiple : typeof trade.r_multiple === "string" && trade.r_multiple.trim() ? Number(trade.r_multiple) : NaN;
    if (!trade.trade_key || seen.has(trade.trade_key) || !Number.isFinite(r)
      || !Number.isFinite(Date.parse(trade.entered_at)) || !Number.isFinite(Date.parse(trade.exited_at))) return false;
    seen.add(trade.trade_key); return true;
  });
  const relation = (value: any) => Array.isArray(value) ? value[0] : value;
  const definition = relation(row.strategy_definitions);
  return {
    id: row.id, assetId: row.asset_id, symbol: relation(row.assets)?.symbol ?? "UNKNOWN",
    definitionId: row.strategy_definition_id, strategyName: definition?.name ?? "UNKNOWN",
    timeframe: definition?.timeframe ?? "UNKNOWN", version: String(definition?.version ?? "UNKNOWN"),
    cutoffAt: row.information_cutoff_at, createdAt: row.created_at, status: row.status,
    candleCount: row.candle_count, setupCount: row.setup_count, tradeCount: row.trade_count,
    minimumSampleSize: row.minimum_sample_size,
    trades: tradesValid ? rawTrades.map((trade: any) => ({ trade_key: trade.trade_key, entered_at: trade.entered_at,
      exited_at: trade.exited_at, r_multiple: Number(trade.r_multiple), side: String(trade.side ?? "UNKNOWN") }))
      .sort((a: LabTrade, b: LabTrade) => a.exited_at.localeCompare(b.exited_at) || a.trade_key.localeCompare(b.trade_key)) : null,
  };
}
