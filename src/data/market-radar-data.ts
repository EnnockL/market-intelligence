import { createServiceClient } from "@/lib/supabase/server";
import type { MarketPulse, Opportunity, RecentSignal } from "@/domain/market";
import type { DataMode } from "./dashboard-data";

export interface MarketRadarData {
  mode: DataMode;
  updatedAt: string | null;
  message: string;
  pulse: MarketPulse[];
  opportunities: Opportunity[];
  recentSignals: RecentSignal[];
  coverage: { wallets: number; stocks: number; tokens: number };
}

export async function getMarketRadarData(): Promise<MarketRadarData> {
  try {
    const db = createServiceClient();
    const [signalsResult, btcAssetResult, regimeResult, walletCount, stockCount, tokenCount] = await Promise.all([
      db.from("signals").select("id,direction,opportunity_score,risk_score,confidence,scoring_version,thesis,observed_price_usd,generated_at,assets(id,symbol,name,kind)").eq("status", "active").order("generated_at", { ascending: false }).limit(12),
      db.from("assets").select("id,symbol").eq("kind", "crypto").eq("symbol", "BTC").limit(1).maybeSingle(),
      db.from("market_regime_snapshots").select("regime,confidence,data_quality,available_at").eq("scope", "GLOBAL").order("available_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("wallets").select("id", { count: "exact", head: true }),
      db.from("assets").select("id", { count: "exact", head: true }).eq("kind", "stock"),
      db.from("assets").select("id", { count: "exact", head: true }).eq("kind", "crypto"),
    ]);
    if (signalsResult.error) throw signalsResult.error;

    let btc: { price: number; change: number | null; at: string } | null = null;
    if (btcAssetResult.data?.id) {
      const { data } = await db.from("crypto_market_observations").select("price_usd,observed_at").eq("asset_id", btcAssetResult.data.id).not("price_usd", "is", null).order("observed_at", { ascending: false }).limit(2);
      if (data?.[0]) btc = { price: Number(data[0].price_usd), change: data[1] ? percent(Number(data[0].price_usd), Number(data[1].price_usd)) : null, at: data[0].observed_at };
    }

    const rows = signalsResult.data ?? [];
    const opportunities = rows.slice(0, 6).flatMap((row: any) => {
      const asset = relation(row.assets);
      if (!asset) return [];
      const itemMode = freshness(row.generated_at);
      return [{ id: asset.id, symbol: asset.symbol, name: asset.name, kind: asset.kind, opportunityScore: Number(row.opportunity_score), riskScore: Number(row.risk_score), confidence: row.confidence === null ? 0 : Number(row.confidence), direction: row.direction, summary: row.thesis ?? "Persisted deterministic signal; open for evidence details.", factors: [`Model ${row.scoring_version}`], negativeFactors: 0, price: nullableNumber(row.observed_price_usd), change24h: null, updatedAt: row.generated_at, dataMode: itemMode === "live" ? "live" : "stale" } satisfies Opportunity];
    });
    const recentSignals = rows.slice(0, 6).map((row: any) => { const asset = relation(row.assets); return { id: row.id, symbol: asset?.symbol ?? "UNKNOWN", label: `${row.direction} · ${row.scoring_version}`, scoreImpact: null, occurredAt: new Date(row.generated_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }) }; });
    const latestTimes = [rows[0]?.generated_at, btc?.at, regimeResult.data?.available_at].filter(Boolean) as string[];
    const updatedAt = latestTimes.sort().at(-1) ?? null;
    const mode: DataMode = updatedAt ? freshness(updatedAt) : "degraded";
    const regime = regimeResult.data;
    return {
      mode,
      updatedAt,
      message: updatedAt ? (mode === "live" ? "Persisted provider data from Supabase" : "Latest persisted data is older than 15 minutes") : "No persisted market observations yet",
      pulse: [
        { label: "S&P 500", value: "UNKNOWN", change: "NO PROVIDER", tone: "neutral", dataMode: "unknown" },
        { label: "NASDAQ", value: "UNKNOWN", change: "NO PROVIDER", tone: "neutral", dataMode: "unknown" },
        btc ? { label: "BTC", value: `$${btc.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, change: btc.change === null ? "NO BASELINE" : `${btc.change >= 0 ? "+" : ""}${btc.change.toFixed(2)}%`, tone: btc.change === null ? "neutral" : btc.change >= 0 ? "positive" : "negative", dataMode: freshness(btc.at) === "live" ? "live" : "stale" } : { label: "BTC", value: "UNKNOWN", change: "NO OBSERVATION", tone: "neutral", dataMode: "unknown" },
        regime ? { label: "Market regime", value: String(regime.regime).replace("_", "-"), change: regime.confidence === null ? "CONFIDENCE UNKNOWN" : `${regime.confidence}% confidence`, tone: "neutral", dataMode: freshness(regime.available_at) === "live" ? "live" : "stale" } : { label: "Market regime", value: "UNKNOWN", change: "INSUFFICIENT DATA", tone: "neutral", dataMode: "unknown" },
      ],
      opportunities,
      recentSignals,
      coverage: { wallets: walletCount.count ?? 0, stocks: stockCount.count ?? 0, tokens: tokenCount.count ?? 0 },
    };
  } catch (error) {
    return { mode: "degraded", updatedAt: null, message: `Supabase data unavailable: ${error instanceof Error ? error.message : "unknown error"}`, pulse: unknownPulse(), opportunities: [], recentSignals: [], coverage: { wallets: 0, stocks: 0, tokens: 0 } };
  }
}

function relation(value: any) { return Array.isArray(value) ? value[0] : value; }
function nullableNumber(value: unknown) { const number = Number(value); return value === null || value === undefined || !Number.isFinite(number) ? null : number; }
function percent(current: number, prior: number) { return prior > 0 ? ((current - prior) / prior) * 100 : null; }
function freshness(at: string): "live" | "stale" { return Date.now() - Date.parse(at) <= 15 * 60_000 ? "live" : "stale"; }
function unknownPulse(): MarketPulse[] { return ["S&P 500", "NASDAQ", "BTC", "Market regime"].map((label) => ({ label, value: "UNKNOWN", change: "NO LIVE DATA", tone: "neutral", dataMode: "unknown" })); }
