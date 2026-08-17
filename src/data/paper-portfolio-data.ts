import { createServiceClient } from "@/lib/supabase/server";
export async function getPaperPortfolioData() {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("paper_portfolios")
      .select(
        "id,name,policy_version,initial_capital_sek,cash_sek,status,paper_positions(id,asset_id,quantity,average_entry_price,current_price,market_value,realized_pnl,unrealized_pnl,closed_at,assets(symbol)),paper_orders(id,candidate_id,side,requested_amount,executed_amount,execution_price,fees,slippage,status,reason,created_at,assets(symbol))",
      )
      .eq("portfolio_scope", "SYSTEM_RESEARCH")
      .order("created_at");
    if (error) throw error;
    return {
      mode: "live" as const,
      portfolios: (data ?? []).map((p: any) => {
        const positions = p.paper_positions ?? [],
          orders = p.paper_orders ?? [],
          cash = Number(p.cash_sek),
          open = positions.filter((x: any) => !x.closed_at),
          equity =
            cash +
            open.reduce((n: number, x: any) => n + Number(x.market_value), 0),
          initial = Number(p.initial_capital_sek);
        return {
          id: p.id,
          name: p.name,
          policy: p.policy_version,
          initial,
          cash,
          equity,
          returnPct: initial ? (equity / initial - 1) * 100 : 0,
          openPositions: open.length,
          closedTrades: positions.filter((x: any) => x.closed_at).length,
          realizedPnl: positions.reduce(
            (n: number, x: any) => n + Number(x.realized_pnl),
            0,
          ),
          unrealizedPnl: open.reduce(
            (n: number, x: any) => n + Number(x.unrealized_pnl),
            0,
          ),
          orders: orders
            .slice(0, 20)
            .map((o: any) => ({
              id: o.id,
              candidateId: o.candidate_id,
              symbol:
                (Array.isArray(o.assets) ? o.assets[0] : o.assets)?.symbol ??
                "UNKNOWN",
              side: o.side,
              requested: Number(o.requested_amount),
              executed: Number(o.executed_amount),
              price:
                o.execution_price === null ? null : Number(o.execution_price),
              fees: o.fees,
              status: o.status,
              reason: o.reason,
              createdAt: o.created_at,
            })),
        };
      }),
    };
  } catch (error) {
    return {
      mode: "degraded" as const,
      portfolios: [],
      error: error instanceof Error ? error.message : "Unavailable",
    };
  }
}
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
