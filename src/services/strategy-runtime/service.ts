import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import {
  evaluateStrategy,
  type StrategyDefinition,
} from "@/domain/strategy-pattern-lab";
import {
  shadowOpen,
  resolveShadowClose,
  signalDecision,
  STRATEGY_SHADOW_VERSION,
  STRATEGY_SIGNAL_PRODUCER_VERSION,
} from "@/domain/strategy-runtime-signal";
import { StrategyAttributionService } from "@/services/strategy-attribution/service";
import { TechnicalStructureService } from "@/services/technical-structure/service";
const n = (v: unknown) => Number(v);
export class StrategyRuntimeService {
  constructor(private db: SupabaseClient) {}
  async produce(cutoffAt = new Date().toISOString(), limit = 20) {
    const assessments = await this.db
      .from("strategy_runtime_assessments")
      .select(
        "id,strategy_definition_id,validation_run_id,decision,information_cutoff_at",
      )
      .lte("available_at", cutoffAt)
      .order("information_cutoff_at", { ascending: false })
      .limit(limit * 3);
    if (assessments.error) throw assessments.error;
    const seen = new Set<string>();
    let evaluated = 0,
      signalsCreated = 0,
      noTrade = 0,
      insufficient = 0;
    for (const runtime of assessments.data ?? []) {
      if (seen.has(runtime.strategy_definition_id)) continue;
      seen.add(runtime.strategy_definition_id);
      if (evaluated >= limit) break;
      evaluated++;
      const validation = runtime.validation_run_id
        ? await this.db
            .from("strategy_validation_runs")
            .select("id,decision,input_snapshot_ids,available_at")
            .eq("id", runtime.validation_run_id)
            .lte("available_at", cutoffAt)
            .maybeSingle()
        : { data: null, error: null };
      if (validation.error) throw validation.error;
      const definition = await this.db
        .from("strategy_definitions")
        .select("id,version,definition,available_at")
        .eq("id", runtime.strategy_definition_id)
        .lte("available_at", cutoffAt)
        .maybeSingle();
      if (definition.error) throw definition.error;
      const runIds = Array.isArray(validation.data?.input_snapshot_ids)
        ? validation.data!.input_snapshot_ids.filter(
            (x: unknown): x is string => typeof x === "string",
          )
        : [];
      const source = runIds.length
        ? await this.db
            .from("strategy_evaluation_runs")
            .select("id,asset_id")
            .in("id", runIds)
            .order("information_cutoff_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
      if (source.error) throw source.error;
      let setup: any = null,
        evidenceRefs: string[] = [];
      if (definition.data && source.data) {
        const d = definition.data.definition as StrategyDefinition,
          candles = await new TechnicalStructureService(this.db).loadCandles(
            source.data.asset_id,
            d.timeframe,
            cutoffAt,
          ),
          evaluation = evaluateStrategy(d, candles, cutoffAt),
          bucketStart = new Date(Date.parse(cutoffAt) - 300000).toISOString(),
          trade = [...evaluation.trades]
            .reverse()
            .find((x) => x.enteredAt >= bucketStart && x.enteredAt <= cutoffAt);
        if (trade) {
          setup = {
            side: trade.side,
            entry: trade.entry,
            stop: trade.stop,
            target: trade.target,
            setupAt: trade.enteredAt,
            evidenceRefs: trade.evidenceRefs,
          };
          evidenceRefs = trade.evidenceRefs;
        }
      }
      const result = signalDecision({
        runtimeDecision: runtime.decision,
        validationDecision: validation.data?.decision ?? "INSUFFICIENT_DATA",
        setup,
        cutoffAt,
      });
      let signalId: string | null = null;
      if (
        result.decision === "SIGNAL_CREATED" &&
        definition.data &&
        validation.data &&
        source.data
      ) {
        const attribution = await new StrategyAttributionService(
          this.db,
        ).register({
          strategyDefinitionId: definition.data.id,
          strategyVersion: definition.data.version,
          validationRunId: validation.data.id,
          runtimeAssessmentId: runtime.id,
          informationCutoffAt: cutoffAt,
          availableAt: cutoffAt,
        });
        const signalKey = deterministicDigest({
          version: STRATEGY_SIGNAL_PRODUCER_VERSION,
          attributionId: attribution.id,
          assetId: source.data.asset_id,
          setup,
        });
        const existing = await this.db
          .from("strategy_runtime_signals")
          .select("id")
          .eq("signal_key", signalKey)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
          signalId = existing.data.id;
        } else {
          const saved = await this.db
            .from("strategy_runtime_signals")
            .insert({
              signal_key: signalKey,
              signal_version: STRATEGY_SIGNAL_PRODUCER_VERSION,
              strategy_attribution_id: attribution.id,
              strategy_definition_id: definition.data.id,
              validation_run_id: validation.data.id,
              runtime_assessment_id: runtime.id,
              asset_id: source.data.asset_id,
              side: setup.side,
              setup_at: setup.setupAt,
              entry: setup.entry,
              stop: setup.stop,
              target: setup.target,
              expires_at: new Date(
                Date.parse(setup.setupAt) + 86400000,
              ).toISOString(),
              evidence_refs: evidenceRefs,
              information_cutoff_at: cutoffAt,
              available_at: cutoffAt,
              input_hash: result.resultHash,
            })
            .select("id")
            .single();
          if (saved.error) throw saved.error;
          signalId = saved.data.id;
          signalsCreated++;
        }
        const open = shadowOpen({
          signalId: signalId!,
          side: setup.side,
          entry: setup.entry,
          feeBps: 10,
          slippageBps: 10,
          stressSlippageBps: 30,
          cutoffAt,
        });
        const revisionKey = deterministicDigest({
          signalId,
          revision: 1,
          version: STRATEGY_SHADOW_VERSION,
        });
        const opened = await this.db
          .from("strategy_shadow_trade_revisions")
          .upsert(
            {
              revision_key: revisionKey,
              shadow_version: STRATEGY_SHADOW_VERSION,
              signal_id: signalId,
              revision_number: 1,
              state: "OPEN",
              modeled_entry: open.modeledEntry,
              stress_entry: open.stressEntry,
              exit_price: null,
              exit_reason: null,
              modeled_r: null,
              stress_r: null,
              fees_bps: 10,
              slippage_bps: 10,
              stress_slippage_bps: 30,
              evidence_refs: evidenceRefs,
              information_cutoff_at: cutoffAt,
              available_at: cutoffAt,
              result_hash: open.resultHash,
            },
            { onConflict: "revision_key", ignoreDuplicates: true },
          );
        if (opened.error) throw opened.error;
      } else {
        noTrade++;
        if (!definition.data || !source.data) insufficient++;
      }
      const evaluationKey = deterministicDigest({
        version: STRATEGY_SIGNAL_PRODUCER_VERSION,
        runtimeId: runtime.id,
        assetId: source.data?.asset_id ?? null,
        resultHash: result.resultHash,
      });
      const savedEval = await this.db
        .from("strategy_signal_evaluations")
        .upsert(
          {
            evaluation_key: evaluationKey,
            producer_version: STRATEGY_SIGNAL_PRODUCER_VERSION,
            strategy_definition_id: runtime.strategy_definition_id,
            validation_run_id: validation.data?.id ?? null,
            runtime_assessment_id: runtime.id,
            asset_id: source.data?.asset_id ?? null,
            decision: result.decision,
            blockers: result.blockers,
            evidence_refs: evidenceRefs,
            signal_id: signalId,
            information_cutoff_at: cutoffAt,
            available_at: cutoffAt,
            result_hash: result.resultHash,
          },
          { onConflict: "evaluation_key", ignoreDuplicates: true },
        );
      if (savedEval.error) throw savedEval.error;
    }
    return {
      evaluated,
      signalsCreated,
      noTrade,
      insufficient,
      liveExecution: false,
      version: STRATEGY_SIGNAL_PRODUCER_VERSION,
    };
  }
  async advance(cutoffAt = new Date().toISOString(), limit = 50) {
    const signals = await this.db
      .from("strategy_runtime_signals")
      .select("id,asset_id,side,entry,stop,target,expires_at,setup_at")
      .lte("available_at", cutoffAt)
      .order("setup_at")
      .limit(limit * 4);
    if (signals.error) throw signals.error;
    let inspected = 0,
      closed = 0,
      open = 0;
    for (const signal of signals.data ?? []) {
      if (inspected >= limit) break;
      const latest = await this.db
        .from("strategy_shadow_trade_revisions")
        .select("*")
        .eq("signal_id", signal.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data || latest.data.state !== "OPEN") continue;
      inspected++;
      const candles = await this.db
        .from("market_candles")
        .select("id,high,low,close,closed_at,available_at")
        .eq("asset_id", signal.asset_id)
        .gt("closed_at", latest.data.information_cutoff_at)
        .lte("closed_at", cutoffAt)
        .lte("available_at", cutoffAt)
        .order("closed_at");
      if (candles.error) throw candles.error;
      if (!candles.data?.length) {
        open++;
        continue;
      }
      let result: ReturnType<typeof resolveShadowClose> = null,
        closingCandle: any = null;
      for (const candle of candles.data) {
        const expired = candle.closed_at >= signal.expires_at;
        result = resolveShadowClose({
          side: signal.side as "LONG" | "SHORT",
          entry: n(signal.entry),
          stop: n(signal.stop),
          target: n(signal.target),
          modeledEntry: n(latest.data.modeled_entry),
          stressEntry: n(latest.data.stress_entry),
          high: n(candle.high),
          low: n(candle.low),
          close: n(candle.close),
          expired,
        });
        if (result) {
          closingCandle = candle;
          break;
        }
      }
      if (!result) {
        open++;
        continue;
      }
      const revision = latest.data.revision_number + 1,
        revisionKey = deterministicDigest({
          signalId: signal.id,
          revision,
          version: STRATEGY_SHADOW_VERSION,
          result,
        });
      const saved = await this.db
        .from("strategy_shadow_trade_revisions")
        .upsert(
          {
            revision_key: revisionKey,
            shadow_version: STRATEGY_SHADOW_VERSION,
            signal_id: signal.id,
            revision_number: revision,
            state: "CLOSED",
            modeled_entry: latest.data.modeled_entry,
            stress_entry: latest.data.stress_entry,
            exit_price: result.exitPrice,
            exit_reason: result.exitReason,
            modeled_r: result.modeledR,
            stress_r: result.stressR,
            fees_bps: latest.data.fees_bps,
            slippage_bps: latest.data.slippage_bps,
            stress_slippage_bps: latest.data.stress_slippage_bps,
          evidence_refs: [closingCandle.id],
          information_cutoff_at: cutoffAt,
            available_at: cutoffAt,
            result_hash: result.resultHash,
          },
          { onConflict: "revision_key", ignoreDuplicates: true },
        );
      if (saved.error) throw saved.error;
      closed++;
    }
    return {
      inspected,
      open,
      closed,
      liveExecution: false,
      version: STRATEGY_SHADOW_VERSION,
    };
  }
}
