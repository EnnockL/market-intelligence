import { createClient } from "@supabase/supabase-js";
import { stockRadar as mockStocks } from "./mock-market";
import type { StockRadarItem } from "@/domain/market";

export type DataMode = "live" | "stale" | "degraded" | "mock";
export interface DashboardStockData { mode: DataMode; updatedAt: string | null; stocks: StockRadarItem[]; message: string; }

export async function getDashboardStockData(): Promise<DashboardStockData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("your-project")) return fallback("Market provider is not configured");
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const symbols = ["AAPL", "NVDA", "AMD", "TSLA", "MSFT"];
    const { data: assets, error: assetError } = await db.from("assets").select("id,symbol").eq("kind", "stock").in("symbol", symbols);
    if (assetError) throw assetError;
    if (!assets?.length) return fallback("No ingested stock snapshots yet");
    const { data: prices, error: priceError } = await db.from("market_prices").select("asset_id,close,open,captured_at").in("asset_id", assets.map((asset) => asset.id)).order("captured_at", { ascending: false });
    if (priceError) throw priceError;
    const latest = new Map<string, { close: number; open: number | null; captured_at: string }>();
    for (const row of prices ?? []) if (!latest.has(row.asset_id)) latest.set(row.asset_id, { close: Number(row.close), open: row.open === null ? null : Number(row.open), captured_at: row.captured_at });
    const rows = assets.flatMap((asset) => { const price = latest.get(asset.id); if (!price) return []; const change = price.open ? ((price.close - price.open) / price.open) * 100 : 0; return [{ symbol: asset.symbol, signal: "neutral" as const, score: 0, catalyst: `Live quote $${price.close.toFixed(2)}`, change: Math.round(change * 100) / 100 }]; });
    if (!rows.length) return fallback("No ingested stock snapshots yet");
    const updatedAt = [...latest.values()].map((value) => value.captured_at).sort().at(-1) ?? null;
    const stale = !updatedAt || Date.now() - new Date(updatedAt).getTime() > 15 * 60 * 1000;
    return { mode: stale ? "stale" : "live", updatedAt, stocks: rows, message: stale ? "Latest provider data is older than 15 minutes" : "Finnhub snapshots" };
  } catch (error) {
    return fallback(`Live data unavailable: ${error instanceof Error ? error.message : "unknown error"}`, "degraded");
  }
}

function fallback(message: string, mode: DataMode = "mock"): DashboardStockData { return { mode, updatedAt: null, stocks: mockStocks, message }; }

