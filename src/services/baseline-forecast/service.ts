import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  BASELINE_COHORT_POLICY,
  BASELINE_FEATURE_VERSION,
  BASELINE_FORECAST_VERSION,
  buildHistoricalBaseline,
  calculateForwardReturn,
  targetTime,
  type BaselineAssetClass,
  type BaselineFeature,
  type HistoricalExample,
} from "@/domain/baseline-forecast";
import { createEventEnvelope, deterministicDigest } from "@/domain/events";
import {
  forecastKey,
  horizonMs,
  type ForecastHorizon,
} from "@/domain/forecast";
import { BASELINE_INPUT_POLICY, loadBaselineObservations, type BaselineObservation } from "./observations";
import { BASELINE_TARGET_POLICY, loadBaselineTargets } from "./targets";
export class BaselineForecastService {
  constructor(private db: SupabaseClient) { }
  async run(now = new Date().toISOString()) {
    const runKey = deterministicDigest({
      version: BASELINE_FORECAST_VERSION,
      slot: baselineRunSlot(now),
    });
    let { data: run, error } = await this.db
      .from("baseline_forecast_runs")
      .select("*")
      .eq("run_key", runKey)
      .maybeSingle();
    if (error) throw error;
    if (run?.status === "COMPLETED")
      return {
        runId: run.id,
        reused: true,
        evaluated: run.forecasts_evaluated,
        available: run.forecasts_available,
      };
    if (!run) {
      const created = await this.db
        .from("baseline_forecast_runs")
        .insert({
          run_key: runKey,
          model_version: BASELINE_FORECAST_VERSION,
          feature_version: BASELINE_FEATURE_VERSION,
          cohort_policy_version: BASELINE_COHORT_POLICY.version,
          information_cutoff_at: now,
          status: "RUNNING",
        })
        .select("*")
        .single();
      if (created.error) throw created.error;
      run = created.data;
    }
    let evaluated = 0, available = 0;
    try {
      const targets = await loadBaselineTargets(this.db, now);
      const observationCache = new Map<
        string,
        BaselineObservation[]
      >();
      const exampleCache = new Map<string, HistoricalExample[]>();
      const failures: string[] = [];
      for (const target of targets ?? []) {
        try {
          const cutoff = new Date(target.information_cutoff_at).toISOString();
          const assetClass: BaselineAssetClass | null = target.asset_kind === "stock" ? "STOCK" : target.asset_kind === "crypto" ? "CRYPTO" : null;
          const observationKey = `${target.asset_id}:${assetClass}:${cutoff}`;
          let observations = observationCache.get(observationKey);
          if (!observations) {
            observations = assetClass ? await loadBaselineObservations(this.db, target.asset_id, assetClass, cutoff) : [];
            observationCache.set(observationKey, observations);
          }
          const exampleKey = `${observationKey}:${target.horizon}`;
          let examples = exampleCache.get(exampleKey);
          if (!examples) {
            examples = historicalExamples(
              observations,
              target.horizon as ForecastHorizon,
              cutoff,
            );
            exampleCache.set(exampleKey, examples);
          }
          const result = await this.evaluate(target, assetClass, observations, examples);
          evaluated++;
          if (result.status === "AVAILABLE") available++;
        } catch (cause) {
          // One damaged target must not starve the rest of either lane. Failed
          // targets stay pending; the run remains visibly FAILED, not green.
          const detail = cause as { code?: unknown; message?: unknown } | null;
          const code = typeof detail?.message === "string" && /^BASELINE_[A-Z_]+$/.test(detail.message)
            ? detail.message : typeof detail?.code === "string" && /^[A-Z0-9]{5}$/.test(detail.code) ? detail.code : "UNAVAILABLE";
          failures.push(`${target.id}:${code}`);
        }
      }
      if (failures.length) throw new Error(`BASELINE_TARGET_FAILURE: ${failures.length} of ${targets.length}; source IDs: ${failures.join(",")}`);
      const saved = await this.db
        .from("baseline_forecast_runs")
        .update({
          status: "COMPLETED",
          completed_at: new Date().toISOString(),
          forecasts_evaluated: evaluated,
          forecasts_available: available,
          last_error: null,
        })
        .eq("id", run.id);
      if (saved.error) throw saved.error;
      return { runId: run.id, reused: false, evaluated, available };
    } catch (cause) {
      await this.db
        .from("baseline_forecast_runs")
        .update({
          status: "FAILED",
          forecasts_evaluated: evaluated,
          forecasts_available: available,
          last_error: cause instanceof Error ? cause.message : String(cause),
        })
        .eq("id", run.id);
      throw cause;
    }
  }
  private async evaluate(
    target: any,
    assetClass: BaselineAssetClass | null,
    targetRows: BaselineObservation[],
    examples: HistoricalExample[],
  ) {
    const horizon = target.horizon as ForecastHorizon,
      cutoff = new Date(target.information_cutoff_at).toISOString(),
      last = targetRows.at(-1) ?? null,
      stale = !!last && Date.parse(cutoff) - Date.parse(last.observedAt) > BASELINE_INPUT_POLICY.maxTargetAgeMs,
      current = stale ? null : last,
      targetFeature = featureAt(targetRows, current, assetClass ?? "CRYPTO");
    const result = buildHistoricalBaseline(
      targetFeature,
      examples,
      horizon,
      cutoff,
    ),
      key = deterministicDigest({
        sourceForecastId: target.id, forecastKey: forecastKey({
          assetId: target.asset_id,
          catalystId: target.catalyst_id,
          horizon,
          cutoff,
          version: BASELINE_FORECAST_VERSION,
        })
      });
    if (!assetClass) result.reason = "UNSUPPORTED_ASSET_CLASS";
    else if (stale) result.reason = "TARGET_OBSERVATION_STALE";
    const evidence = current ? [current.id] : [];
    const forecastId = randomUUID();
    const emittedAt = new Date().toISOString();
    const forecast = {
      id: forecastId,
      forecast_key: key,
      asset_id: target.asset_id,
      opportunity_id: target.opportunity_id,
      candidate_id: target.candidate_id,
      catalyst_id: target.catalyst_id,
      forecast_version: BASELINE_FORECAST_VERSION,
      forecast_method:
        result.status === "AVAILABLE"
          ? "HISTORICAL_BASELINE"
          : "INSUFFICIENT_DATA",
      model_version: BASELINE_FORECAST_VERSION,
      feature_set_version: BASELINE_FEATURE_VERSION,
      training_cutoff_at: cutoff,
      information_cutoff_at: cutoff,
      available_at: emittedAt,
      horizon,
      status: result.status,
      reason: result.reason,
      expected_return: result.expectedReturn,
      lower_bound: result.lowerBound,
      upper_bound: result.upperBound,
      probability_positive: result.probabilityPositive,
      probability_2x: result.probability2x,
      probability_5x: result.probability5x,
      probability_10x: result.probability10x,
      confidence:
        result.status === "AVAILABLE"
          ? Math.min(
            100,
            Math.round(
              (result.sampleSize /
                BASELINE_COHORT_POLICY.minimumSampleSize) *
              70,
            ),
          )
          : null,
      data_quality: result.dataQuality,
      evidence_refs: evidence,
      agent_inputs: {
        cohortPolicy: BASELINE_COHORT_POLICY.version,
        sampleSize: result.sampleSize,
        modelHash: result.modelHash,
        sourceForecastId: target.id,
        assetClass,
        observationSource: assetClass === "STOCK" ? "market_candles" : assetClass === "CRYPTO" ? "crypto_market_observations" : null,
        volumeBasis: assetClass === "STOCK" ? "COMPLETED_5M_BAR" : "ROLLING_24H_SNAPSHOT",
        inputPolicy: BASELINE_INPUT_POLICY,
        targetPolicy: BASELINE_TARGET_POLICY,
        inputRowCount: targetRows.length,
        inputStartsAt: targetRows[0]?.observedAt ?? null,
        inputEndsAt: targetRows.at(-1)?.observedAt ?? null,
        inputHash: deterministicDigest(targetRows),
      },
      market_regime: null,
    };
    const snapshotKey = deterministicDigest({
      forecastId,
      feature: targetFeature,
      version: BASELINE_FEATURE_VERSION,
    });
    const snapshot = {
      snapshot_key: snapshotKey,
      forecast_id: forecastId,
      asset_id: target.asset_id,
      feature_version: BASELINE_FEATURE_VERSION,
      information_cutoff_at: cutoff,
      available_at: emittedAt,
      price_momentum_5m: targetFeature.priceMomentum5m,
      volume_multiple_5m: targetFeature.volumeMultiple5m,
      liquidity_usd: targetFeature.liquidityUsd,
      market_cap_usd: targetFeature.marketCapUsd,
      data_quality: targetFeature.dataQuality,
      feature_payload: targetFeature,
      feature_hash: deterministicDigest(targetFeature),
    };
    const exampleMap = new Map(examples.map((x) => [x.sourceId, x]));
    const cohort = result.members.map((member) => {
      const x = exampleMap.get(member.sourceId)!;
      return {
        forecast_id: forecastId,
        source_observation_id: assetClass === "CRYPTO" ? x.sourceId : null,
        source_candle_id: assetClass === "STOCK" ? x.sourceId : null,
        anchor_at: x.anchorAt,
        outcome_at: x.outcomeAt,
        return_pct: x.returnPct,
        feature_distance: 0,
        available_at: x.availableAt,
        member_hash: deterministicDigest({
          forecastId,
          sourceId: x.sourceId,
        }),
      };
    });
    const event = createEventEnvelope({
      eventType: "forecast.baseline_created",
      entityType: "forecast",
      entityId: forecastId,
      assetId: target.asset_id,
      occurredAt: emittedAt,
      observedAt: emittedAt,
      availableAt: emittedAt,
      provider: "baseline-forecast",
      sourceReference: `baseline:${key}`,
      dataQuality: result.dataQuality ?? 0,
      confidence: null,
      payload: {
        status: result.status,
        reason: result.reason,
        horizon,
        sampleSize: result.sampleSize,
        modelVersion: BASELINE_FORECAST_VERSION,
      },
      correlationId: target.catalyst_id,
      causationId: null,
    });
    const { data, error } = await this.db.rpc("persist_baseline_forecast_bundle_v2", {
      p_forecast: forecast, p_snapshot: snapshot, p_members: cohort,
      p_event: {
        event_id: event.eventId, schema_version: event.schemaVersion, event_type: event.eventType,
        entity_type: event.entityType, entity_id: event.entityId, asset_id: event.assetId,
        occurred_at: event.occurredAt, observed_at: event.observedAt, available_at: event.availableAt,
        provider: event.provider, source_reference: event.sourceReference, data_quality: event.dataQuality,
        confidence: event.confidence, payload: event.payload, payload_hash: event.payloadHash,
        correlation_id: event.correlationId, causation_id: event.causationId,
      },
      // Identity excludes generated IDs and write timestamps, but includes all
      // information used to compute the immutable result on a retry.
      p_bundle_hash: deterministicDigest({ key, inputs: forecast.agent_inputs, feature: targetFeature, result }),
    });
    if (error) throw error;
    if (!data || !["AVAILABLE", "INSUFFICIENT_DATA"].includes(data.status)) throw new Error("BASELINE_BUNDLE_NOT_CONFIRMED");
    return { status: data.status, reused: data.reused === true };
  }
}
export function baselineRunSlot(now: string) {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error("Invalid baseline run time");
  return new Date(Math.floor(time / 300_000) * 300_000).toISOString();
}
function firstAtOrAfter(rows: BaselineObservation[], at: string) {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].observedAt < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

function priorFor(rows: BaselineObservation[], current: BaselineObservation) {
  const desired = new Date(Date.parse(current.observedAt) - 300_000).toISOString();
  let index = firstAtOrAfter(rows, desired);
  if (rows[index]?.observedAt !== desired) index--;
  const prior = rows[index];
  // A previous trading day's close is not five-minute momentum. Late-known
  // observations cannot enter the anchor's historical feature vector either.
  return prior && Date.parse(desired) - Date.parse(prior.observedAt) <= BASELINE_INPUT_POLICY.priorToleranceMs
    && prior.availableAt <= current.availableAt ? prior : null;
}

export function featureAt(rows: BaselineObservation[], current: BaselineObservation | null, assetClass: BaselineAssetClass): BaselineFeature {
  if (!current) return { assetClass, priceMomentum5m: null, volumeMultiple5m: null, liquidityUsd: null, marketCapUsd: null, dataQuality: 0 };
  const prior = priorFor(rows, current);
  return {
    assetClass,
    priceMomentum5m: prior?.price && current.price ? (current.price / prior.price - 1) * 100 : null,
    volumeMultiple5m: prior?.volume && current.volume !== null ? current.volume / prior.volume : null,
    liquidityUsd: current.liquidityUsd,
    marketCapUsd: current.marketCapUsd,
    dataQuality: Math.min(current.dataQuality, prior?.dataQuality ?? current.dataQuality),
  };
}

export function historicalExamples(rows: BaselineObservation[], horizon: ForecastHorizon, cutoff: string) {
  const out: HistoricalExample[] = [];
  for (const anchor of rows) {
    if (!anchor.price || anchor.availableAt > cutoff) continue;
    const desired = targetTime(anchor.observedAt, horizon);
    const max = new Date(Date.parse(desired) + Math.max(60_000, horizonMs(horizon) * 0.1)).toISOString();
    const exit = rows[firstAtOrAfter(rows, desired)];
    if (!exit?.price || exit.observedAt > max || exit.observedAt > cutoff || exit.availableAt > cutoff) continue;
    const prior = priorFor(rows, anchor);
    const availableAt = [prior?.availableAt ?? anchor.availableAt, anchor.availableAt, exit.availableAt].sort().at(-1)!;
    out.push({
      sourceId: anchor.id,
      assetId: anchor.assetId,
      anchorAt: anchor.observedAt,
      outcomeAt: exit.observedAt,
      availableAt,
      features: featureAt(rows, anchor, anchor.assetClass),
      returnPct: calculateForwardReturn(anchor.price, exit.price),
    });
  }
  return out;
}
