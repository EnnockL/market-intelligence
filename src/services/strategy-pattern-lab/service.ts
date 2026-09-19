import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { evaluateStrategy, STRATEGY_LAB_VERSION, type StrategyDefinition } from "@/domain/strategy-pattern-lab";
import { TechnicalStructureService } from "@/services/technical-structure/service";
import { readFrozenStrategyDataset } from "@/domain/frozen-strategy-dataset";

export class StrategyPatternLabService {
  constructor(private db: SupabaseClient) {}
  async runFrozen(planId: string) {
    const sealed = await this.db.rpc("seal_strategy_dataset", { p_plan_id: planId });
    if (sealed.error) throw sealed.error;
    const frozen = readFrozenStrategyDataset(Array.isArray(sealed.data) && sealed.data.length === 1 ? sealed.data[0] : sealed.data);
    return this.run(frozen.definition, frozen.plan.asset_id, frozen.endsAt, frozen.startsAt, frozen);
  }
  async run(definition: StrategyDefinition, assetId: string, cutoffAt: string, startsAt?: string, frozen?: ReturnType<typeof readFrozenStrategyDataset>) {
    const definitionHash = deterministicDigest(definition);
    let { data: stored, error: definitionError } = await this.db.from("strategy_definitions").select("id,definition_hash").eq("strategy_key", definition.strategyId).eq("version", definition.version).maybeSingle();
    if (definitionError) throw definitionError;
    if (stored && stored.definition_hash !== definitionHash) throw new Error("STRATEGY_DEFINITION_VERSION_CONFLICT");
    if (!stored) {
      const created = await this.db.from("strategy_definitions").insert({ strategy_key: definition.strategyId, version: definition.version, name: definition.name, market: definition.market, timeframe: definition.timeframe, setup_type: definition.setupType, definition, definition_hash: definitionHash, effective_at: cutoffAt, available_at: cutoffAt }).select("id").single();
      if (created.error) throw created.error; stored = { ...created.data, definition_hash: definitionHash };
    }
    const storedDefinitionId = stored.id;
    const loadedCandles = frozen?.candles ?? await new TechnicalStructureService(this.db).loadCandles(assetId, definition.timeframe, cutoffAt);
    const candles = startsAt ? loadedCandles.filter(candle => candle.openedAt >= startsAt) : loadedCandles;
    const { data: regimes, error: regimeError } = frozen ? { data: frozen.regimes, error: null } : await this.db.from("market_regime_snapshots").select("regime,information_cutoff_at,available_at").lte("available_at", cutoffAt).order("information_cutoff_at");
    if (regimeError) throw regimeError;
    const evaluation = evaluateStrategy(definition, candles, cutoffAt, at => [...(regimes ?? [])].reverse().find((item: any) => item.available_at <= at && item.information_cutoff_at <= at)?.regime ?? "UNKNOWN");
    if (frozen) evaluation.inputHash = frozen.inputHash;
    const runKey = deterministicDigest({ labVersion: STRATEGY_LAB_VERSION, definitionHash, assetId, inputHash: evaluation.inputHash });
    if (frozen) {
      const published = await this.db.rpc("publish_frozen_strategy_evaluation", {
        p_run: { run_key: runKey, lab_version: STRATEGY_LAB_VERSION, strategy_definition_id: storedDefinitionId, asset_id: assetId,
          information_cutoff_at: cutoffAt, status: evaluation.status, reason: evaluation.reason, input_hash: evaluation.inputHash,
          candle_count: evaluation.candleCount, setup_count: evaluation.setupCount, trade_count: evaluation.tradeCount,
          sample_size: evaluation.sampleSize, minimum_sample_size: evaluation.minimumSampleSize, metrics: evaluation.metrics,
          result_hash: deterministicDigest(evaluation), frozen_dataset_id: frozen.datasetId },
        p_trades: evaluation.trades.map(t => ({ trade_key:t.tradeKey,side:t.side,setup_at:t.setupAt,entered_at:t.enteredAt,exited_at:t.exitedAt,
          entry:t.entry,stop:t.stop,target:t.target,exit:t.exit,outcome:t.outcome,r_multiple:t.rMultiple,mfe_r:t.mfeR,mae_r:t.maeR,
          hold_minutes:t.holdMinutes,evidence_refs:t.evidenceRefs,session:t.session,weekday:t.weekday,regime:t.regime,entry_hour:t.entryHour,volatility_bucket:t.volatilityBucket })),
        p_segments: evaluation.segments.map(s=>({dimension:s.dimension,value:s.value,sample_size:s.sampleSize,status:s.status,win_rate:s.winRate,average_r:s.averageR})),
      });
      if (published.error) throw published.error;
      return { runId: published.data as string, evaluation };
    }
    const existing = await this.db.from("strategy_evaluation_runs").select("id,status,trade_count,metrics").eq("run_key", runKey).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { runId: existing.data.id, reused: true, evaluation };
    const resultHash = deterministicDigest(evaluation);
    const created = await this.db.from("strategy_evaluation_runs").insert({ run_key: runKey, lab_version: STRATEGY_LAB_VERSION, strategy_definition_id: storedDefinitionId, asset_id: assetId, information_cutoff_at: cutoffAt, available_at: cutoffAt, status: evaluation.status, reason: evaluation.reason, input_hash: evaluation.inputHash, candle_count: evaluation.candleCount, setup_count: evaluation.setupCount, trade_count: evaluation.tradeCount, sample_size: evaluation.sampleSize, minimum_sample_size: evaluation.minimumSampleSize, metrics: evaluation.metrics, result_hash: resultHash }).select("id").single();
    if (created.error) throw created.error;
    if (evaluation.trades.length) {
      const trades = await this.db.from("strategy_evaluation_trades").insert(evaluation.trades.map(trade => ({ evaluation_run_id: created.data.id, trade_key: trade.tradeKey, side: trade.side, setup_at: trade.setupAt, entered_at: trade.enteredAt, exited_at: trade.exitedAt, entry: trade.entry, stop: trade.stop, target: trade.target, exit: trade.exit, outcome: trade.outcome, r_multiple: trade.rMultiple, mfe_r: trade.mfeR, mae_r: trade.maeR, hold_minutes: trade.holdMinutes, evidence_refs: trade.evidenceRefs, session: trade.session, weekday: trade.weekday, regime: trade.regime, entry_hour: trade.entryHour, volatility_bucket: trade.volatilityBucket })));
      if (trades.error) throw trades.error;
    }
    if (evaluation.segments.length) {
      const segments = await this.db.from("strategy_segment_metrics").insert(evaluation.segments.map(segment => ({ evaluation_run_id: created.data.id, dimension: segment.dimension, value: segment.value, sample_size: segment.sampleSize, status: segment.status, win_rate: segment.winRate, average_r: segment.averageR })));
      if (segments.error) throw segments.error;
    }
    return { runId: created.data.id, reused: false, evaluation };
  }
}
