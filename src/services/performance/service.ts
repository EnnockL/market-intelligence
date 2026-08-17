import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import {
  calculatePerformance,
  PERFORMANCE_MODEL_VERSION,
} from "@/domain/performance";
export class PerformanceService {
  constructor(private db: SupabaseClient) {}
  async run(cutoff = new Date().toISOString()) {
    const { data: portfolios, error } = await this.db
      .from("paper_portfolios")
      .select("*")
      .eq("portfolio_scope", "SYSTEM_RESEARCH");
    if (error) throw error;
    let created = 0;
    for (const p of portfolios ?? []) {
      const [
        { data: e, error: ee },
        { data: o, error: oe },
        { data: pos, error: pe },
        { data: eq, error: qe },
      ] = await Promise.all([
        this.db
          .from("paper_policy_evaluations")
          .select("candidate_id,status,reason,decision_cutoff")
          .eq("portfolio_id", p.id)
          .lte("decision_cutoff", cutoff),
        this.db
          .from("paper_orders")
          .select(
            "id,status,requested_amount,executed_amount,fees,slippage,created_at",
          )
          .eq("portfolio_id", p.id)
          .lte("created_at", cutoff),
        this.db
          .from("paper_positions")
          .select(
            "opened_at,closed_at,realized_pnl,unrealized_pnl,market_value,cost_basis",
          )
          .eq("portfolio_id", p.id)
          .lte("opened_at", cutoff),
        this.db
          .from("paper_equity_points")
          .select("captured_at,total_equity")
          .eq("portfolio_id", p.id)
          .lte("information_cutoff_at", cutoff)
          .order("captured_at"),
      ]);
      if (ee) throw ee;
      if (oe) throw oe;
      if (pe) throw pe;
      if (qe) throw qe;
      const input = {
          initialCash: Number(p.initial_capital_sek),
          currentCash: Number(p.cash_sek),
          evaluations: (e ?? []).map((x: any) => ({
            candidateId: x.candidate_id,
            status: x.status,
            reason: x.reason,
          })),
          orders: (o ?? []).map((x: any) => ({
            id: x.id,
            status: x.status,
            requested: Number(x.requested_amount),
            executed: Number(x.executed_amount),
            fees: Number(x.fees?.total ?? 0),
            slippageCost: Number(x.slippage?.sek ?? 0),
          })),
          positions: (pos ?? []).map((x: any) => ({
            openedAt: x.opened_at,
            closedAt: x.closed_at,
            realizedPnl: Number(x.realized_pnl),
            unrealizedPnl: Number(x.unrealized_pnl),
            marketValue: Number(x.market_value),
            costBasis: Number(x.cost_basis),
          })),
          equityPoints: (eq ?? []).map((x: any) => ({
            at: x.captured_at,
            equity: Number(x.total_equity),
          })),
        },
        result = calculatePerformance(input),
        hash = deterministicDigest({
          portfolio: p.id,
          policy: p.policy_version,
          model: PERFORMANCE_MODEL_VERSION,
          input,
        });
      const { data: saved, error: se } = await this.db
        .from("performance_snapshots")
        .upsert(
          {
            portfolio_id: p.id,
            policy_version: p.policy_version,
            model_version: PERFORMANCE_MODEL_VERSION,
            information_cutoff_at: cutoff,
            input_hash: hash,
            funnel: result.funnel,
            rates: result.rates,
            reject_reasons: result.rejectReasons,
            blockers: result.blockers,
            coverage: result.coverage,
            metrics: result.metrics,
            limitations: ["USD_SEK_FIXED_10_5", "SMALL_OR_EMPTY_TRADE_SAMPLE"],
          },
          { onConflict: "input_hash", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (se) throw se;
      if (saved) created++;
    }
    return { portfolios: (portfolios ?? []).length, created };
  }
}
