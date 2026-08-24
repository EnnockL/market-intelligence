import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { evaluateStrategy, STRATEGY_LAB_VERSION, type StrategyDefinition } from "@/domain/strategy-pattern-lab";
import { TechnicalStructureService } from "@/services/technical-structure/service";

export class StrategyPatternLabService {
  constructor(private db: SupabaseClient) {}
  async run(definition: StrategyDefinition, assetId: string, cutoffAt: string) {
    const definitionHash = deterministicDigest(definition);
    let { data: stored, error: definitionError } = await this.db.from("strategy_definitions").select("id").eq("strategy_key", definition.strategyId).eq("version", definition.version).maybeSingle();
    if (definitionError) throw definitionError;
    if (!stored) {
      const created = await this.db.from("strategy_definitions").insert({ strategy_key: definition.strategyId, version: definition.version, name: definition.name, market: definition.market, timeframe: definition.timeframe, setup_type: definition.setupType, definition, definition_hash: definitionHash, effective_at: cutoffAt, available_at: cutoffAt }).select("id").single();
      if (created.error) throw created.error; stored = created.data;
    }
    const candles = await new TechnicalStructureService(this.db).loadCandles(assetId, definition.timeframe, cutoffAt);
    const { data: regimes, error: regimeError } = await this.db.from("market_regime_snapshots").select("regime,information_cutoff_at,available_at").lte("available_at", cutoffAt).order("information_cutoff_at");
    if (regimeError) throw regimeError;
    const evaluation = evaluateStrategy(definition, candles, cutoffAt, at => [...(regimes ?? [])].reverse().find((item: any) => item.available_at <= at && item.information_cutoff_at <= at)?.regime ?? "UNKNOWN");
    const runKey = deterministicDigest({ labVersion: STRATEGY_LAB_VERSION, definitionHash, assetId, inputHash: evaluation.inputHash });
    const existing = await this.db.from("strategy_evaluation_runs").select("id,status,trade_count,metrics").eq("run_key", runKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { runId: existing.data.id, reused: true, evaluation };
    const resultHash = deterministicDigest(evaluation);
    const created = await this.db.from("strategy_evaluation_runs").insert({ run_key: runKey, lab_version: STRATEGY_LAB_VERSION, strategy_definition_id: stored.id, asset_id: assetId, information_cutoff_at: cutoffAt, available_at: cutoffAt, status: evaluation.status, reason: evaluation.reason, input_hash: evaluation.inputHash, candle_count: evaluation.candleCount, setup_count: evaluation.setupCount, trade_count: evaluation.tradeCount, sample_size: evaluation.sampleSize, minimum_sample_size: evaluation.minimumSampleSize, metrics: evaluation.metrics, result_hash: resultHash }).select("id").single();
    if (created.error) throw created.error;
    if (evaluation.trades.length) {
      const trades = await this.db.from("strategy_evaluation_trades").insert(evaluation.trades.map(trade => ({ evaluation_run_id: created.data.id, trade_key: trade.tradeKey, side: trade.side, setup_at: trade.setupAt, entered_at: trade.enteredAt, exited_at: trade.exitedAt, entry: trade.entry, stop: trade.stop, target: trade.target, exit: trade.exit, outcome: trade.outcome, r_multiple: trade.rMultiple, mfe_r: trade.mfeR, mae_r: trade.maeR, hold_minutes: trade.holdMinutes, evidence_refs: trade.evidenceRefs, session: trade.session, weekday: trade.weekday, regime: trade.regime })));
      if (trades.error) throw trades.error;
    }
    if (evaluation.segments.length) {
      const segments = await this.db.from("strategy_segment_metrics").insert(evaluation.segments.map(segment => ({ evaluation_run_id: created.data.id, dimension: segment.dimension, value: segment.value, sample_size: segment.sampleSize, status: segment.status, win_rate: segment.winRate, average_r: segment.averageR })));
      if (segments.error) throw segments.error;
    }
    return { runId: created.data.id, reused: false, evaluation };
  }
}
