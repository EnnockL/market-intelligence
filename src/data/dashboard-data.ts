import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StockRadarItem } from "@/domain/market";
import { type DataMode } from "./data-truth";
import { groupFreshness, numberOrNull } from "./bounded-latest";

export type { DataMode } from "./data-truth";
export interface DashboardStockData { mode: DataMode; updatedAt: string | null; provider: string; stocks: StockRadarItem[]; message: string; }

export async function getDashboardStockData(): Promise<DashboardStockData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("your-project")) return fallback("Market provider is not configured");
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    return await loadDashboardStockData(db);
  } catch { return fallback("Stock data could not be loaded. Try again shortly.", "degraded"); }
}

export async function loadDashboardStockData(db: SupabaseClient, now = Date.now()): Promise<DashboardStockData> {
  try {
    const symbols = ["AAPL", "NVDA", "AMD", "TSLA", "MSFT"];
    const { data: assets, error: assetError } = await db.from("assets").select("id,symbol").eq("kind", "stock").in("symbol", symbols).order("symbol").order("id").limit(symbols.length + 1);
    if (assetError) throw assetError;
    if (!assets?.length) return fallback("No ingested stock snapshots yet");
    if (new Set(assets.map(asset => asset.symbol)).size !== assets.length || assets.length > symbols.length) throw new Error("AMBIGUOUS_STOCK_UNIVERSE");
    // Five indexed latest-row queries in parallel, not the full quote history
    // or a global LIMIT that lets one frequently updated stock hide the others.
    const prices = await Promise.all(assets.map(async asset => {
      const { data, error } = await db.from("market_prices").select("asset_id,close,open,captured_at")
        .eq("asset_id", asset.id).eq("interval", "quote").lte("captured_at", new Date(now).toISOString())
        .order("captured_at", { ascending: false }).order("provider").order("interval").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    }));
    const latest = new Map<string, { close: number; open: number | null; captured_at: string }>();
    for (const row of prices) {
      if (!row) continue;
      const close = numberOrNull(row.close), open = numberOrNull(row.open);
      if (close === null || close <= 0) throw new Error("STOCK_QUOTE_VALUE_UNKNOWN");
      latest.set(row.asset_id, { close, open: open !== null && open > 0 ? open : null, captured_at: row.captured_at });
    }
    const rows = assets.flatMap((asset) => { const price = latest.get(asset.id); if (!price) return []; const change = price.open ? ((price.close - price.open) / price.open) * 100 : null; return [{ symbol: asset.symbol, signal: "neutral" as const, score: null, catalyst: `Persisted quote $${price.close.toFixed(2)}`, change: change === null ? null : Math.round(change * 100) / 100 }]; });
    if (!rows.length) return fallback("No ingested stock snapshots yet");
    const { mode, updatedAt } = groupFreshness(symbols.map(symbol => latest.get(assets.find(asset => asset.symbol === symbol)?.id ?? "")?.captured_at), now);
    return { mode, updatedAt, provider: "Finnhub → Supabase", stocks: rows, message: mode === "degraded" ? `${rows.length}/${symbols.length} configured stocks have usable quotes` : mode === "stale" ? "One or more displayed quotes are older than 15 minutes" : "Persisted Finnhub snapshots" };
  } catch { return fallback("Stock data could not be loaded. Try again shortly.", "degraded"); }
}

function fallback(message: string, mode: DataMode = "unavailable"): DashboardStockData { return { mode, updatedAt: null, provider: "Finnhub → Supabase", stocks: [], message }; }
