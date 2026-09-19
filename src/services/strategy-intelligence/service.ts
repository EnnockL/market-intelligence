import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStrategyPerformanceSnapshot, selectStrategies, STRATEGY_RESEARCH_VERSION, STRATEGY_SELECTOR_VERSION, type StrategyPerformanceSnapshot, type StrategySelectorContext } from "@/domain/strategy-intelligence";
import { classifyResearchProvenance } from "@/domain/strategy-intelligence-provenance";
import { deterministicDigest } from "@/domain/events";
import type { StrategyTrade } from "@/domain/strategy-pattern-lab";
import { readFrozenStrategyDataset } from "@/domain/frozen-strategy-dataset";

export class StrategyIntelligenceService {
  constructor(private db: SupabaseClient, private now = () => new Date().toISOString()) {}

  async researchEvaluation(evaluationRunId: string, options: { cutoffAt?: string } = {}) {
    const asOf = options.cutoffAt ?? this.now();
    const query = await this.db.from("strategy_evaluation_runs").select("*,assets(id,symbol,kind),strategy_definitions(id,strategy_key,version,market,timeframe),strategy_evaluation_trades(*)").eq("id", evaluationRunId).lte("information_cutoff_at", asOf).lte("available_at", asOf).lte("created_at", asOf).single();
    if (query.error) throw query.error;
    const run: any = query.data, trades = (run.strategy_evaluation_trades ?? []).map(mapTrade).sort((a: StrategyTrade, b: StrategyTrade) => a.enteredAt.localeCompare(b.enteredAt));
    const cutoff = new Date(run.information_cutoff_at).toISOString();
    let frozen: ReturnType<typeof readFrozenStrategyDataset> | undefined;
    if (run.frozen_dataset_id) {
      const row = await this.db.from("strategy_frozen_datasets").select("*").eq("id", run.frozen_dataset_id).lte("created_at", asOf).single();
      if (row.error) throw row.error;
      frozen = readFrozenStrategyDataset(row.data);
      if (frozen.inputHash !== run.input_hash || frozen.plan.strategy_definition_id !== run.strategy_definition_id
        || frozen.plan.asset_id !== run.asset_id || frozen.endsAt !== cutoff) throw new Error("FROZEN_RESEARCH_SCOPE_MISMATCH");
    }
    const windowStart = frozen?.startsAt ?? trades.at(0)?.enteredAt ?? cutoff, windowEnd = frozen?.endsAt ?? trades.map((trade: StrategyTrade) => trade.exitedAt).sort().at(-1) ?? cutoff;
    if (Date.parse(windowStart) > Date.parse(windowEnd) || Date.parse(windowEnd) > Date.parse(cutoff)) throw new Error("INVALID_RESEARCH_TRADE_WINDOW");
    const validations = await this.db.from("strategy_validation_runs").select("id,phase,strategy_definition_id,input_snapshot_ids,available_at,created_at").eq("strategy_definition_id", run.strategy_definition_id).contains("input_snapshot_ids", [run.id]).lte("available_at", asOf).lte("created_at", asOf).order("created_at", { ascending: false }).limit(100);
    if (validations.error) throw validations.error;
    const { split, provenance } = classifyResearchProvenance({ evaluationRunId: run.id, strategyDefinitionId: run.strategy_definition_id, evaluationInputHash: run.input_hash ?? null, cutoffAt: asOf, frozen: frozen ? { datasetId: frozen.datasetId, planId: frozen.plan.id, strategyDefinitionId: frozen.plan.strategy_definition_id, inputHash: frozen.inputHash, startsAt: frozen.startsAt, endsAt: frozen.endsAt, registeredAt: frozen.plan.created_at, sealedAt: frozen.createdAt } : undefined, validations: (validations.data ?? []).map(row => ({ id: row.id, phase: row.phase, strategyDefinitionId: row.strategy_definition_id, evaluationRunIds: Array.isArray(row.input_snapshot_ids) ? row.input_snapshot_ids : [], availableAt: row.available_at, createdAt: row.created_at })) });
    const session = common(trades.map((item: StrategyTrade) => item.session)), regime = common(trades.map((item: StrategyTrade) => item.regime));
    const snapshot = buildStrategyPerformanceSnapshot({ strategyId: run.strategy_definitions.strategy_key, strategyVersion: run.strategy_definitions.version, evaluationRunId: run.id, assetId: run.asset_id, asset: run.assets.symbol, assetClass: String(run.assets.kind).toUpperCase(), market: run.strategy_definitions.market, timeframe: run.strategy_definitions.timeframe, windowStart, windowEnd, informationCutoffAt: cutoff, availableAt: this.now(), provenance, session, regime, split, minimumSampleSize: run.minimum_sample_size, setupCount: run.setup_count, expectedTradeCount: run.trade_count, dataQuality: frozen?.dataQuality ?? null, trades });
    const existing = await this.db.from("strategy_performance_snapshots").select("id,available_at").eq("snapshot_key", snapshot.snapshotKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { snapshotId: existing.data.id, reused: true, snapshot: { ...snapshot, availableAt: existing.data.available_at } };
    const insert = await this.db.from("strategy_performance_snapshots").insert({ snapshot_key: snapshot.snapshotKey, performance_version: snapshot.performanceVersion, strategy_definition_id: run.strategy_definitions.id, evaluation_run_id: run.id, asset_id: run.asset_id, evaluation_window_start: snapshot.windowStart, evaluation_window_end: snapshot.windowEnd, information_cutoff_at: snapshot.informationCutoffAt, available_at: snapshot.availableAt, provenance, dataset_hash: snapshot.datasetHash, market: snapshot.market, asset_class: snapshot.assetClass, timeframe: snapshot.timeframe, session: snapshot.session, regime: snapshot.regime, dataset_split: snapshot.split, status: snapshot.status, reason: snapshot.reason, sample_size: snapshot.sampleSize, setup_count: snapshot.setupCount, trade_count: snapshot.tradeCount, data_quality: snapshot.dataQuality, metrics: snapshot.metrics, segments: snapshot.segments, result_hash: deterministicDigest({ ...snapshot, availableAt: undefined }) }).select("id").single();
    if (insert.error) throw insert.error;
    return { snapshotId: insert.data.id, reused: false, snapshot };
  }

  async select(context: StrategySelectorContext) {
    const query = await this.db.from("strategy_performance_snapshots").select("*,strategy_definitions(strategy_key,version),assets(symbol)").eq("performance_version", STRATEGY_RESEARCH_VERSION).eq("asset_id", context.assetId).eq("timeframe", context.timeframe).lte("information_cutoff_at", context.cutoffAt).lte("available_at", context.cutoffAt).lte("created_at", context.cutoffAt).order("information_cutoff_at", { ascending: false }).order("snapshot_key", { ascending: false }).limit(1000);
    if (query.error) throw query.error;
    const snapshots: StrategyPerformanceSnapshot[] = (query.data ?? []).map((row: any) => ({ snapshotKey: row.snapshot_key, performanceVersion: row.performance_version, datasetHash: row.dataset_hash, status: row.status, reason: row.reason, strategyId: row.strategy_definitions.strategy_key, strategyVersion: row.strategy_definitions.version, evaluationRunId: row.evaluation_run_id, assetId: row.asset_id, asset: row.assets.symbol, assetClass: row.asset_class, market: row.market, timeframe: row.timeframe, windowStart: row.evaluation_window_start, windowEnd: row.evaluation_window_end, informationCutoffAt: row.information_cutoff_at, availableAt: row.available_at, provenance: row.provenance ?? undefined, session: row.session, regime: row.regime, split: row.dataset_split, sampleSize: row.sample_size, setupCount: row.setup_count, tradeCount: row.trade_count, metrics: row.metrics, segments: row.segments, dataQuality: row.data_quality }));
    const result = selectStrategies(context, snapshots), selectorKey = deterministicDigest({ version: STRATEGY_SELECTOR_VERSION, context, inputs: snapshots.map(item => item.snapshotKey).sort() });
    const existing = await this.db.from("strategy_selector_runs").select("id").eq("selector_key", selectorKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { selectorRunId: existing.data.id, reused: true, result };
    const insert = await this.db.from("strategy_selector_runs").insert({ selector_key: selectorKey, selector_version: STRATEGY_SELECTOR_VERSION, asset_id: context.assetId, timeframe: context.timeframe, session: context.session, regime: context.regime, volatility_bucket: context.volatilityBucket, liquidity_bucket: context.liquidityBucket, information_cutoff_at: context.cutoffAt, available_at: this.now(), status: result.status, input_snapshot_keys: snapshots.map(item => item.snapshotKey).sort(), ranked_strategies: result.rankedStrategies, selected_strategy: result.selectedStrategy, result_hash: result.resultHash }).select("id").single();
    if (insert.error) throw insert.error;
    return { selectorRunId: insert.data.id, reused: false, result };
  }
}

function mapTrade(row: any): StrategyTrade { return { tradeKey: row.trade_key, side: row.side, setupAt: new Date(row.setup_at).toISOString(), enteredAt: new Date(row.entered_at).toISOString(), exitedAt: new Date(row.exited_at).toISOString(), entry: Number(row.entry), stop: Number(row.stop), target: Number(row.target), exit: Number(row.exit), outcome: row.outcome, rMultiple: Number(row.r_multiple), mfeR: Number(row.mfe_r), maeR: Number(row.mae_r), holdMinutes: Number(row.hold_minutes), evidenceRefs: row.evidence_refs ?? [], session: row.session, weekday: row.weekday, regime: row.regime, entryHour: row.entry_hour ?? "UNKNOWN", volatilityBucket: row.volatility_bucket ?? "UNKNOWN" }; }
function common(values: string[]) { const unique = [...new Set(values)]; return unique.length === 1 ? unique[0] : "UNKNOWN"; }
