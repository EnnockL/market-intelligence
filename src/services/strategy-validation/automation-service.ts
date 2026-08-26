import type { SupabaseClient } from "@supabase/supabase-js";
import {
  nextValidationWindow,
  shadowObservation,
  VALIDATION_WINDOW_PLANNER_VERSION,
} from "@/domain/validation-automation";
import { StrategyValidationService } from "@/services/strategy-validation/service";

export class ValidationAutomationService {
  constructor(private db: SupabaseClient) {}
  async plan(cutoffAt = new Date().toISOString()) {
    const hypotheses = await this.db
      .from("strategy_hypotheses")
      .select("id,strategy_definition_id,registered_at")
      .lte("available_at", cutoffAt)
      .order("registered_at");
    if (hypotheses.error) throw hypotheses.error;
    let ready = 0,
      insufficient = 0,
      blocked = 0,
      completed = 0,
      validated = 0;
    for (const h of hypotheses.data ?? []) {
      const [runs, validations] = await Promise.all([
        this.db
          .from("strategy_evaluation_runs")
          .select(
            "id,information_cutoff_at,available_at,trade_count,strategy_evaluation_trades(entered_at,exited_at)",
          )
          .eq("strategy_definition_id", h.strategy_definition_id)
          .lte("available_at", cutoffAt)
          .order("information_cutoff_at"),
        this.db
          .from("strategy_validation_runs")
          .select("phase,decision,window_end")
          .eq("strategy_definition_id", h.strategy_definition_id)
          .eq("hypothesis_id", h.id)
          .lte("available_at", cutoffAt)
          .order("information_cutoff_at"),
      ]);
      if (runs.error) throw runs.error;
      if (validations.error) throw validations.error;
      const windows = (runs.data ?? []).map((r: any) => {
        const trades = r.strategy_evaluation_trades ?? [];
        return {
          id: r.id,
          startsAt: trades.length
            ? trades.map((t: any) => t.entered_at).sort()[0]
            : r.information_cutoff_at,
          endsAt: trades.length
            ? trades
                .map((t: any) => t.exited_at)
                .sort()
                .at(-1)
            : r.information_cutoff_at,
          availableAt: r.available_at,
          tradeCount: r.trade_count,
        };
      });
      const plan = nextValidationWindow({
        strategyDefinitionId: h.strategy_definition_id,
        hypothesisId: h.id,
        registeredAt: h.registered_at,
        cutoffAt,
        runs: windows,
        completed: (validations.data ?? []) as any,
      });
      const saved = await this.db
        .from("strategy_validation_window_plans")
        .upsert(
          {
            plan_key: plan.planKey,
            planner_version: VALIDATION_WINDOW_PLANNER_VERSION,
            strategy_definition_id: h.strategy_definition_id,
            hypothesis_id: h.id,
            phase: plan.phase,
            status: plan.status,
            reason: plan.reason,
            window_start: plan.windowStart,
            window_end: plan.windowEnd,
            evaluation_run_ids: plan.evaluationRunIds,
            information_cutoff_at: cutoffAt,
            available_at: cutoffAt,
            plan_hash: plan.planHash,
          },
          { onConflict: "plan_key", ignoreDuplicates: true },
        );
      if (saved.error) throw saved.error;
      if (plan.status === "READY") {
        ready++;
        await new StrategyValidationService(this.db).validate({
          evaluationRunIds: plan.evaluationRunIds,
          hypothesisId: h.id,
          phase: plan.phase!,
        });
        validated++;
      } else if (plan.status === "BLOCKED") blocked++;
      else if (plan.status === "COMPLETED") completed++;
      else insufficient++;
    }
    return {
      evaluated: hypotheses.data?.length ?? 0,
      ready,
      validated,
      insufficient,
      blocked,
      completed,
    };
  }
  async track(cutoffAt = new Date().toISOString()) {
    const end = new Date(
        Math.floor(Date.parse(cutoffAt) / 300000) * 300000,
      ).toISOString(),
      start = new Date(Date.parse(end) - 300000).toISOString();
    const runtime = await this.db
      .from("strategy_runtime_assessments")
      .select("id,strategy_definition_id,runtime_state")
      .in("runtime_state", ["DEMO_VALIDATION", "APPROVED_SHADOW"])
      .lte("available_at", end)
      .order("information_cutoff_at");
    if (runtime.error) throw runtime.error;
    const [proposalRows, intentRows, orderRows, fillRows, rejected] =
      await Promise.all([
        this.db
          .from("trade_proposals")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end),
        this.db
          .from("execution_intents")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end),
        this.db
          .from("execution_orders")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end),
        this.db
          .from("execution_fills")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end),
        this.db
          .from("trade_eligibility_evaluations")
          .select("id", { count: "exact", head: true })
          .eq("decision", "REJECTED")
          .gte("created_at", start)
          .lt("created_at", end),
      ]);
    for (const result of [
      proposalRows,
      intentRows,
      orderRows,
      fillRows,
      rejected,
    ])
      if (result.error) throw result.error;
    const proposals = proposalRows.count ?? 0,
      intents = intentRows.count ?? 0,
      orders = orderRows.count ?? 0,
      fills = fillRows.count ?? 0;
    let created = 0;
    for (const row of runtime.data ?? []) {
      const mode = row.runtime_state === "DEMO_VALIDATION" ? "DEMO" : "SHADOW",
        observation = shadowObservation({
          strategyDefinitionId: row.strategy_definition_id,
          runtimeAssessmentId: row.id,
          mode,
          cutoffAt: end,
          bucketStartedAt: start,
          globalCounts: {
            proposals,
            intents,
            orders,
            fills,
            rejected: rejected.count ?? 0,
          },
        });
      const saved = await this.db
        .from("strategy_shadow_observations")
        .upsert(
          {
            observation_key: observation.observationKey,
            tracking_version: observation.trackingVersion,
            strategy_definition_id: row.strategy_definition_id,
            runtime_assessment_id: row.id,
            mode,
            attribution_status: observation.attributionStatus,
            bucket_started_at: start,
            bucket_ended_at: end,
            information_cutoff_at: end,
            available_at: end,
            global_metrics: observation.metrics,
            strategy_metrics: {
              proposals: null,
              intents: null,
              orders: null,
              fills: null,
            },
            evidence_refs: [],
            result_hash: observation.resultHash,
          },
          { onConflict: "observation_key", ignoreDuplicates: true },
        );
      if (saved.error) throw saved.error;
      created++;
    }
    return {
      tracked: runtime.data?.length ?? 0,
      created,
      global: {
        proposals,
        intents,
        orders,
        fills,
        rejected: rejected.count ?? 0,
      },
      attribution: "UNKNOWN",
    };
  }
}
