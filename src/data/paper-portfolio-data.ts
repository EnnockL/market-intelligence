import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { DataMode } from "./data-truth";
import { numberOrNull } from "./bounded-latest";

export interface PaperPortfolioSummary {
  id: string; name: string; policy: string | null; initial: number; cash: number;
  equity: number; returnPct: number; openPositions: number;
}
export interface PaperOrderSummary {
  id: string; candidateId: string; symbol: string; side: string; requested: number;
  executed: number; price: number | null; fees: unknown; status: string; reason: string | null; createdAt: string;
}
interface PaperPerformance {
  funnel: Record<string, number>; rates: Record<string, unknown>; reject_reasons: Record<string, number>;
  metrics: Record<string, unknown>; information_cutoff_at: string;
}
export interface PaperPortfolioDetail extends PaperPortfolioSummary {
  closedTrades: number; realizedPnl: number; unrealizedPnl: number;
  performance: PaperPerformance | null; orders: PaperOrderSummary[];
}
interface PaperData<T> { mode: DataMode; portfolios: T[]; error: string | null }
type FinancialSnapshot = Omit<PaperPortfolioDetail, "performance" | "orders">;

export async function getPaperPortfolioSummaryData(): Promise<PaperData<PaperPortfolioSummary>> {
  try { return await loadPaperPortfolioSummaryData(createServiceClient()); }
  catch { return unavailable(); }
}

export async function getPaperPortfolioData(): Promise<PaperData<PaperPortfolioDetail>> {
  try { return await loadPaperPortfolioData(createServiceClient()); }
  catch { return unavailable(); }
}

/** The dashboard needs balances, not every historical order or performance run. */
export async function loadPaperPortfolioSummaryData(db: SupabaseClient, _now = Date.now()): Promise<PaperData<PaperPortfolioSummary>> {
  try {
    const snapshot = await loadFinancialSnapshot(db);
    return ready(snapshot.portfolios.map(({ closedTrades: _closed, realizedPnl: _realized, unrealizedPnl: _unrealized, ...summary }) => summary));
  } catch { return unavailable(); }
}

export async function loadPaperPortfolioData(db: SupabaseClient, _now = Date.now()): Promise<PaperData<PaperPortfolioDetail>> {
  try {
    const snapshot = await loadFinancialSnapshot(db), cutoff = snapshot.capturedAt;
    const portfolios = await Promise.all(snapshot.portfolios.map(async financial => {
      // Each portfolio gets its own latest window. A busy policy cannot consume
      // another policy's twenty order slots or its latest performance snapshot.
      const [orders, performance] = await Promise.all([
        db.from("paper_orders").select("id,candidate_id,side,requested_amount,executed_amount,execution_price,fees,status,reason,created_at,assets(symbol)")
          .eq("portfolio_id", financial.id).lte("created_at", cutoff).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20),
        db.from("performance_snapshots").select("funnel,rates,reject_reasons,metrics,information_cutoff_at")
          .eq("portfolio_id", financial.id).lte("information_cutoff_at", cutoff).lte("created_at", cutoff)
          .order("information_cutoff_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (orders.error) throw orders.error;
      if (performance.error) throw performance.error;
      return { ...financial,
        performance: performance.data as PaperPerformance | null,
        orders: (orders.data ?? []).map((order: any): PaperOrderSummary => ({ id: order.id, candidateId: order.candidate_id,
          symbol: (Array.isArray(order.assets) ? order.assets[0] : order.assets)?.symbol ?? "UNKNOWN", side: order.side,
          requested: requiredNumber(order.requested_amount), executed: requiredNumber(order.executed_amount), price: numberOrNull(order.execution_price),
          fees: order.fees, status: order.status, reason: order.reason, createdAt: order.created_at })),
      };
    }));
    return ready(portfolios);
  } catch { return unavailable(); }
}

async function loadFinancialSnapshot(db: SupabaseClient): Promise<{ capturedAt: string; portfolios: FinancialSnapshot[] }> {
  // Cash and position values must come from the same SQL statement snapshot.
  // Never fall back to separate mutable reads if this RPC is not yet deployed.
  const { data, error } = await db.rpc("frontend_paper_snapshot_v1");
  if (error) throw error;
  if (data?.version !== "frontend-paper-snapshot-v1" || data.status !== "READY" || data.reason !== null
    || !Number.isFinite(Date.parse(data.capturedAt)) || !Array.isArray(data.portfolios) || data.portfolios.length > 20) throw new Error("PAPER_SNAPSHOT_UNAVAILABLE");
  const portfolios = data.portfolios.map((row: any): FinancialSnapshot => {
    if (typeof row.id !== "string" || typeof row.name !== "string" || (row.policy !== null && typeof row.policy !== "string")) throw new Error("PAPER_SNAPSHOT_INVALID");
    const initial = requiredNumber(row.initial), cash = requiredNumber(row.cash), equity = requiredNumber(row.equity);
    const openPositions = requiredNumber(row.openPositions), closedTrades = requiredNumber(row.closedTrades);
    if (initial <= 0 || cash < 0 || equity < 0 || !Number.isSafeInteger(openPositions) || openPositions < 0 || !Number.isSafeInteger(closedTrades) || closedTrades < 0) throw new Error("PAPER_SNAPSHOT_INVALID");
    return { id: row.id, name: row.name, policy: row.policy, initial, cash, equity,
      returnPct: requiredNumber(row.returnPct), openPositions, closedTrades,
      realizedPnl: requiredNumber(row.realizedPnl), unrealizedPnl: requiredNumber(row.unrealizedPnl) };
  });
  if (new Set(portfolios.map((row: FinancialSnapshot) => row.id)).size !== portfolios.length) throw new Error("PAPER_SNAPSHOT_INVALID");
  return { capturedAt: data.capturedAt, portfolios };
}

function requiredNumber(value: unknown) {
  const number = numberOrNull(value);
  if (number === null) throw new Error("PAPER_VALUE_UNKNOWN");
  return number;
}
function ready<T>(portfolios: T[]): PaperData<T> { return { mode: portfolios.length ? "live" : "unavailable", portfolios, error: null }; }
function unavailable<T>(): PaperData<T> { return { mode: "degraded", portfolios: [], error: "Paper portfolio data could not be fully loaded or valued. Try again shortly." }; }
export async function getPaperTradeDetail(id: string) {
  try {
    const db = createServiceClient(),
      { data, error } = await db
        .from("paper_orders")
        .select(
          "*,paper_policy_evaluations(*),paper_policies(*),paper_fills(*),paper_trade_attribution(*),assets(symbol,name)",
        )
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unavailable",
    };
  }
}
