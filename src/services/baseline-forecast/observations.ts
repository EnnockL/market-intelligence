import type { SupabaseClient } from "@supabase/supabase-js";
import type { BaselineAssetClass } from "@/domain/baseline-forecast";

export const BASELINE_INPUT_POLICY = {
  version: "asset-scoped-recent-history-v2",
  lookbackDays: 30,
  pageSize: 1_000,
  maxRows: 10_000,
  maxTargets: 25,
  maxTargetAgeMs: 10 * 60_000,
  priorToleranceMs: 60_000,
} as const;

export type BaselineObservation = {
  id: string;
  assetId: string;
  assetClass: BaselineAssetClass;
  sourceTable: "market_candles" | "crypto_market_observations";
  observedAt: string;
  availableAt: string;
  price: number | null;
  volume: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  dataQuality: number;
};

export async function loadBaselineObservations(
  db: SupabaseClient,
  assetId: string,
  assetClass: BaselineAssetClass,
  cutoff: string,
) {
  const startsAt = new Date(Date.parse(cutoff) - BASELINE_INPUT_POLICY.lookbackDays * 86_400_000).toISOString();
  const stock = assetClass === "STOCK";
  const table = stock ? "market_candles" : "crypto_market_observations";
  const timeColumn = stock ? "closed_at" : "observed_at";
  const availableColumn = stock ? "available_at" : "ingested_at";
  const rows: BaselineObservation[] = [];
  for (let offset = 0; offset < BASELINE_INPUT_POLICY.maxRows; offset += BASELINE_INPUT_POLICY.pageSize) {
    let query = db.from(table)
      .select(stock
        ? "id,asset_id,closed_at,available_at,close,volume,data_quality"
        : "id,asset_id,observed_at,ingested_at,price_usd,volume_24h_usd,liquidity_usd,market_cap_usd,confidence")
      .eq("asset_id", assetId)
      .gte(timeColumn, startsAt)
      .lte(timeColumn, cutoff)
      .lte(availableColumn, cutoff);
    if (stock) query = query.eq("timeframe", "5m");
    // Read the bounded newest window, paging below the server's 1,000-row cap.
    const result = await query.order(timeColumn, { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + BASELINE_INPUT_POLICY.pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []).map((row: any): BaselineObservation => ({
      id: row.id,
      assetId: row.asset_id,
      assetClass,
      sourceTable: table,
      observedAt: new Date(stock ? row.closed_at : row.observed_at).toISOString(),
      availableAt: new Date(stock ? row.available_at : row.ingested_at).toISOString(),
      price: numeric(stock ? row.close : row.price_usd),
      volume: numeric(stock ? row.volume : row.volume_24h_usd),
      // Pool liquidity is not a stock feature; do not manufacture a proxy.
      liquidityUsd: stock ? null : numeric(row.liquidity_usd),
      marketCapUsd: stock ? null : numeric(row.market_cap_usd),
      dataQuality: numeric(stock ? row.data_quality : row.confidence) ?? 0,
    })));
    if ((result.data ?? []).length < BASELINE_INPUT_POLICY.pageSize) break;
  }
  // One observation per time point prevents multiple providers from inflating n.
  const byTime = new Map<string, BaselineObservation>();
  for (const row of rows) if (!byTime.has(row.observedAt)) byTime.set(row.observedAt, row);
  return [...byTime.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
}

function numeric(value: unknown) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}
