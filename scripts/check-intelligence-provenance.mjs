/** Called only by the memory-only migration runner; no credentials or network. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkIntelligenceProvenance(db) {
  const asset = randomUUID(), definition = randomUUID(), run = randomUUID();
  const cutoff = "2026-08-01T12:00:00Z", published = "2026-09-07T12:00:00Z";
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'stock','PROVENANCE_SQL_FIXTURE','Disposable provenance fixture')", [asset]);
  await db.query(`insert into public.strategy_definitions(id,strategy_key,version,name,market,timeframe,setup_type,definition,definition_hash,effective_at,available_at)
    values($1,$2,1,'Memory-only fixture','NASDAQ','5m','EMA_VWAP_MOMENTUM','{}',$2,$3,$3)`, [definition, `fixture-${definition}`, cutoff]);
  await db.query(`insert into public.strategy_evaluation_runs(id,run_key,lab_version,strategy_definition_id,asset_id,information_cutoff_at,available_at,status,input_hash,candle_count,setup_count,trade_count,sample_size,minimum_sample_size,metrics,result_hash)
    values($1,$2,'fixture',$3,$4,$5,$5,'AVAILABLE',$2,1000,40,40,40,30,'{}',$2)`, [run, `fixture-${run}`, definition, asset, cutoff]);

  const old = {
    id: randomUUID(), snapshot_key: randomUUID(), performance_version: "strategy-research-v1",
    strategy_definition_id: definition, evaluation_run_id: run, asset_id: asset,
    evaluation_window_start: "2026-07-01T00:00:00Z", evaluation_window_end: cutoff,
    information_cutoff_at: cutoff, available_at: cutoff, dataset_hash: "fixture-ledger",
    market: "NASDAQ", asset_class: "STOCK", timeframe: "5m", session: "NEW_YORK", regime: "UNKNOWN",
    dataset_split: "TRAIN", status: "AVAILABLE", reason: null, sample_size: 40, setup_count: 40,
    trade_count: 40, data_quality: null, metrics: { expectedValueR: 0.5 }, segments: [],
    result_hash: randomUUID(), created_at: published, provenance: null,
  };
  const provenance = { version: "intelligence-provenance-v1", status: "UNVERIFIED", reason: "LEARNING_EVIDENCE_NOT_SELECTION_PROOF", evaluationInputHash: `fixture-${run}`, validationRunIds: [], observedPhases: ["LEARNING"], windowSource: "TRADE_SPAN_ONLY", frozenDatasetId: null };
  const current = { ...old, id: randomUUID(), snapshot_key: randomUUID(), performance_version: "strategy-research-v2", available_at: published, provenance };
  const insert = value => db.query("insert into public.strategy_performance_snapshots select * from jsonb_populate_record(null::public.strategy_performance_snapshots,$1::jsonb)", [JSON.stringify(value)]);
  const newIdentity = value => ({ ...value, id: randomUUID(), snapshot_key: randomUUID() });
  await insert(old);
  await insert(current);
  assert.equal((await db.query("select count(*)::integer count from public.strategy_performance_snapshots where evaluation_run_id=$1", [run])).rows[0].count, 2, "v2 provenance coexists with same-window v1 TRAIN history");
  assert.equal((await db.query("select provenance from public.strategy_performance_snapshots where id=$1", [old.id])).rows[0].provenance, null, "legacy history is not relabeled");

  await insert(newIdentity({ ...current, dataset_split: "EXPLORATION", provenance: { ...provenance, observedPhases: [] } }));
  assert.equal((await db.query("select metrics->>'expectedValueR' value from public.strategy_performance_snapshots where id=$1", [current.id])).rows[0].value, "0.5", "exploration metrics are not erased by provenance gating");
  for (const split of ["VALIDATION", "OUT_OF_SAMPLE"]) {
    await assert.rejects(insert(newIdentity({ ...current, dataset_split: split })), error => error.code === "23514", `${split} cannot be asserted without a manifest contract`);
  }
  await assert.rejects(insert(newIdentity({ ...current, provenance: null })), error => error.code === "23514");
  await assert.rejects(insert(newIdentity({ ...current, provenance: {} })), error => error.code === "23514");
  await assert.rejects(insert(newIdentity({ ...current, dataset_split: "OUT_OF_SAMPLE", provenance: { ...provenance, status: "VERIFIED", windowSource: "FROZEN_DATASET_MANIFEST", frozenDatasetId: "unverified-claim" } })), error => error.code === "23514", "caller-provided VERIFIED JSON is not proof");
  await assert.rejects(insert(newIdentity({ ...current, available_at: "2026-07-31T12:00:00Z" })), error => error.code === "23514", "v2 cannot be backdated before its input cutoff");
  await assert.rejects(db.query("update public.strategy_performance_snapshots set dataset_split='OUT_OF_SAMPLE' where id=$1", [old.id]), /immutable/i);

  await db.query(`insert into public.strategy_selector_runs(selector_key,selector_version,asset_id,timeframe,session,regime,volatility_bucket,liquidity_bucket,information_cutoff_at,available_at,status,input_snapshot_keys,ranked_strategies,selected_strategy,result_hash)
    values($1,'strategy-selector-v2',$2,'5m','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN',$3,$4,'NO_STRATEGY_ELIGIBLE','[]','[]',null,$1)`, [randomUUID(), asset, cutoff, published]);
  console.log("Passed: intelligence v1/v2 coexistence, immutable history, exploration metrics, OOS/provenance guard and actual publication time.");
}
