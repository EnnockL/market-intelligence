import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateStrategyCandidate } from "@/domain/strategy-candidate-triage";

export class StrategyCandidateTriageService {
  constructor(private db: SupabaseClient) {}

  async run(cutoffAt = new Date().toISOString()) {
    const [runs, lifecycle] = await Promise.all([
      this.db.from("strategy_evaluation_runs").select("id,strategy_definition_id,asset_id,candle_count,information_cutoff_at,status,strategy_evaluation_trades(trade_key,r_multiple)").eq("status", "AVAILABLE").lte("available_at", cutoffAt).order("information_cutoff_at", { ascending: false }).limit(1000),
      this.db.from("strategy_lifecycle_revisions").select("strategy_definition_id,state,revision_number,available_at").lte("available_at", cutoffAt).order("revision_number", { ascending: false }).limit(1000),
    ]);
    if (runs.error) throw runs.error;
    if (lifecycle.error) throw lifecycle.error;
    const latestState = new Map<string, string>();
    for (const row of lifecycle.data ?? []) if (!latestState.has(row.strategy_definition_id)) latestState.set(row.strategy_definition_id, row.state);
    const latestPerAsset = new Map<string, any>();
    for (const row of runs.data ?? []) {
      const key = `${row.strategy_definition_id}:${row.asset_id}`;
      if (!latestPerAsset.has(key)) latestPerAsset.set(key, row);
    }
    const grouped = new Map<string, any[]>();
    for (const row of latestPerAsset.values()) grouped.set(row.strategy_definition_id, [...(grouped.get(row.strategy_definition_id) ?? []), row]);
    const results = [...grouped.entries()].map(([strategyDefinitionId, rows]) => ({
      strategyDefinitionId,
      result: evaluateStrategyCandidate({
        strategyDefinitionId,
        lifecycleState: latestState.get(strategyDefinitionId) ?? null,
        cutoffAt,
        runs: rows.map((row) => ({ runId: row.id, assetId: row.asset_id, candleCount: row.candle_count, trades: (row.strategy_evaluation_trades ?? []).map((trade: any) => ({ tradeKey: trade.trade_key, rMultiple: Number(trade.r_multiple) })) })),
      }),
    })).sort(compareResults);
    let rank = 0;
    for (const item of results) {
      const assignedRank = item.result.recommendation === "PRIORITIZE" ? ++rank : null;
      const saved = await this.db.from("strategy_candidate_triage_runs").upsert({
        triage_key: item.result.triageKey, triage_version: item.result.triageVersion,
        strategy_definition_id: item.strategyDefinitionId, recommendation: item.result.recommendation,
        rank: assignedRank, input_evaluation_run_ids: item.result.inputEvaluationRunIds,
        metrics: item.result.metrics, blockers: item.result.blockers,
        information_cutoff_at: cutoffAt, available_at: cutoffAt, result_hash: item.result.resultHash,
      }, { onConflict: "triage_key", ignoreDuplicates: true });
      if (saved.error) throw saved.error;
    }
    return { evaluated: results.length, prioritized: rank, triageVersion: results[0]?.result.triageVersion ?? "strategy-candidate-triage-v1" };
  }
}

function compareResults(a: any, b: any) {
  const order: Record<string, number> = { PRIORITIZE: 0, COLLECT_MORE_DATA: 1, DO_NOT_PRIORITIZE: 2, EXCLUDED_REJECTED: 3 };
  return order[a.result.recommendation] - order[b.result.recommendation]
    || Number(b.result.metrics.expectedValueR ?? -Infinity) - Number(a.result.metrics.expectedValueR ?? -Infinity)
    || a.strategyDefinitionId.localeCompare(b.strategyDefinitionId);
}
