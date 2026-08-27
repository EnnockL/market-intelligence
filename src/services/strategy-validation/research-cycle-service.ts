import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateResearchCycle } from "@/domain/strategy-research-cycle";
import { runStrategyResearchCycle } from "@/workers/strategy-pattern-lab";
import { StrategyValidationService } from "./service";

export class StrategyResearchCycleService {
  constructor(private db: SupabaseClient) {}

  async run(cutoffAt = new Date().toISOString()) {
    const rejected = await this.db
      .from("strategy_lifecycle_revisions")
      .select("strategy_definition_id,strategy_definitions(strategy_key,version)")
      .eq("state", "REJECTED")
      .lte("available_at", cutoffAt);
    if (rejected.error) throw rejected.error;
    const excluded = new Set(
      (rejected.data ?? []).map((row: any) => {
        const definition = relation(row.strategy_definitions);
        return `${definition?.strategy_key}:${definition?.version}`;
      }),
    );

    const evaluation = await runStrategyResearchCycle(this.db, cutoffAt, excluded);
    if (!("runId" in evaluation) || !evaluation.runId) return evaluation;

    const run = await this.db
      .from("strategy_evaluation_runs")
      .select("id,strategy_definition_id,status,trade_count,setup_count,minimum_sample_size,strategy_definitions(strategy_key,name,version,setup_type)")
      .eq("id", evaluation.runId)
      .single();
    if (run.error) throw run.error;
    const definition: any = relation(run.data.strategy_definitions);
    if (!definition) throw new Error("STRATEGY_DEFINITION_NOT_FOUND");

    let hypothesis = await this.db
      .from("strategy_hypotheses")
      .select("id")
      .eq("strategy_definition_id", run.data.strategy_definition_id)
      .order("hypothesis_version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (hypothesis.error) throw hypothesis.error;
    if (!hypothesis.data) {
      const text = hypothesisFor(definition);
      const registered = await new StrategyValidationService(this.db).registerHypothesis({
        strategyDefinitionId: run.data.strategy_definition_id,
        hypothesisVersion: 1,
        ...text,
        cutoffAt,
        evidenceRefs: [{ type: "STRATEGY_DEFINITION", id: run.data.strategy_definition_id }],
      });
      hypothesis = { data: { id: registered.hypothesisId }, error: null } as typeof hypothesis;
    }

    const lifecycle = await this.db
      .from("strategy_lifecycle_revisions")
      .select("state")
      .eq("strategy_definition_id", run.data.strategy_definition_id)
      .eq("hypothesis_id", hypothesis.data!.id)
      .lte("available_at", cutoffAt)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lifecycle.error) throw lifecycle.error;

    const result = evaluateResearchCycle({
      strategyDefinitionId: run.data.strategy_definition_id,
      hypothesisId: hypothesis.data!.id,
      evaluationRunId: run.data.id,
      evaluationStatus: run.data.status as "AVAILABLE" | "INSUFFICIENT_DATA",
      lifecycleState: lifecycle.data?.state ?? null,
      tradeCount: run.data.trade_count,
      setupCount: run.data.setup_count,
      minimumSampleSize: run.data.minimum_sample_size,
      cutoffAt,
    });
    const saved = await this.db.from("strategy_research_cycle_runs").upsert({
      cycle_key: result.cycleKey,
      cycle_version: result.cycleVersion,
      strategy_definition_id: run.data.strategy_definition_id,
      hypothesis_id: hypothesis.data!.id,
      evaluation_run_id: run.data.id,
      status: result.status,
      blockers: result.blockers,
      progress: result.progress,
      information_cutoff_at: cutoffAt,
      available_at: cutoffAt,
      result_hash: result.resultHash,
    }, { onConflict: "cycle_key", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    return { ...result, runId: run.data.id, strategyId: definition.strategy_key, strategyName: definition.name };
  }
}

function hypothesisFor(definition: { name: string; setup_type: string }) {
  if (definition.setup_type === "OPENING_RANGE_BREAKOUT") return {
    thesis: `${definition.name} may capture intraday continuation after a confirmed opening-range break under its immutable entry rules.`,
    expectedMechanism: "Price acceptance beyond a price-discovery range may persist after volume, VWAP and retest conditions are satisfied.",
    invalidationCondition: "Modeled-live expectancy is not positive with statistical support, drawdown exceeds policy, or edge fails outside the learning window.",
  };
  if (definition.setup_type === "EMA_VWAP_MOMENTUM") return {
    thesis: `${definition.name} may capture intraday momentum when the versioned EMA relationship agrees with session VWAP.`,
    expectedMechanism: "Confirmed short-term trend persistence may exceed modeled fees and slippage.",
    invalidationCondition: "Modeled-live expectancy is not positive with statistical support, drawdown exceeds policy, or edge fails outside the learning window.",
  };
  return {
    thesis: `${definition.name} may capture reversal after a point-in-time sweep and rejection of a prior session range.`,
    expectedMechanism: "A failed liquidity sweep may revert toward the opposite reference level after price closes back inside the range.",
    invalidationCondition: "Modeled-live expectancy is not positive with statistical support, drawdown exceeds policy, or edge fails outside the learning window.",
  };
}

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

