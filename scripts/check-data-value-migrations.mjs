import { checkProspectiveStrategyDatasets } from "./check-prospective-strategy-datasets.mjs";
/**
 * Isolated schema/RPC smoke test. Uses memory-only PostgreSQL, never application
 * env files, Supabase credentials or a remote database. Optional test dependency:
 * npm install --prefix <temporary-directory> --no-audit --no-fund @electric-sql/pglite
 * node scripts/check-data-value-migrations.mjs <temporary-directory>/node_modules/@electric-sql/pglite
 * This is not a substitute for a Supabase staging migration/HTTP role test.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkIntelligenceProvenance } from "./check-intelligence-provenance.mjs";
import { runDataGapRevisitChecks } from "./check-data-gap-revisit.mjs";
import { checkExecutionFinalGuard } from "./check-execution-final-guard.mjs";
import { checkExecutionFillProvenance } from "./check-execution-fill-provenance.mjs";
import { checkFrontendPaperSnapshot } from "./check-frontend-paper-snapshot.mjs";
import { checkWalletEvidenceWindow } from "./check-wallet-evidence-window.mjs";
import { checkExecutionReconciliation } from "./check-execution-reconciliation.mjs";
import { checkDemoAccountReconciliation } from "./check-demo-account-reconciliation.mjs";

const modulePath = process.argv[2];
const { PGlite } = await import(modulePath ? pathToFileURL(join(modulePath, "dist/index.js")).href : "@electric-sql/pglite");
const { pgcrypto } = await import(modulePath ? pathToFileURL(join(modulePath, "dist/contrib/pgcrypto.js")).href : "@electric-sql/pglite/contrib/pgcrypto");
const db = new PGlite({ extensions: { pgcrypto } });
const migrations = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    alter default privileges in schema public grant all on tables to service_role;`);
  const allFiles = (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
  // The frontend release applied 0081, 0083 and 0091 while the other backend
  // migrations remained local. Exercise that non-contiguous upgrade separately
  // from a fresh database; never "repair" the real migration ledger to test it.
  const upgrade = process.argv.includes("--upgrade-from-frontend-release");
  const inFrontendRelease = file => {
    const version = Number(file.split("_")[0]);
    return version <= 81 || version === 83 || version === 91;
  };
  const files = upgrade
    ? [...allFiles.filter(inFrontendRelease), ...allFiles.filter(file => !inFrontendRelease(file))]
    : allFiles;
  let releaseControls;
  for (const file of files) {
    // Reproduce the hosted pgcrypto schema by the point the existing trigger fix
    // was introduced. Earlier migrations originally installed it in public.
    if (file.startsWith("0064_")) await db.exec("alter extension pgcrypto set schema extensions; set search_path=public,extensions");
    try {
      await db.exec(await readFile(join(migrations, file), "utf8"));
      if (upgrade && file.startsWith("0091_")) releaseControls = await controls();
    }
    catch (error) { throw new Error(`${file}: ${error.code} ${error.message}`); }
  }
  if (upgrade) {
    const after=await controls(), oldKeys=new Set(releaseControls.jobs.map(x=>x.job_key));
    assert.ok(after.jobs.filter(x=>!oldKeys.has(x.job_key)).every(x=>x.enabled===false),"new jobs must start disabled");
    assert.deepEqual({...after,jobs:after.jobs.filter(x=>oldKeys.has(x.job_key))},releaseControls,"backend upgrades must preserve existing trading controls, accounts and job switches");
  }
  console.log(`Applied ${files.length} migrations to disposable PostgreSQL (${upgrade ? "non-contiguous frontend upgrade" : "fresh database"}).`);

  for (const role of ["anon", "authenticated"]) {
    for (const table of ["execution_accounts", "execution_controls", "execution_orders", "risk_ledger_snapshots", "account_state_observations", "scheduled_jobs", "scheduled_job_runs", "ingestion_runs", "provider_errors", "ingestion_work_attempts"]) {
      assert.equal((await db.query("select has_table_privilege($1,$2,'select') allowed", [role, `public.${table}`])).rows[0].allowed, false, `${role} cannot read ${table}`);
    }
    assert.equal((await db.query("select has_function_privilege($1,'public.claim_ingestion_subjects(text,text,integer)','execute') allowed", [role])).rows[0].allowed, false);
  }
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.execution_accounts"), error => error.code === "42501");
  await db.exec("reset role");

  const asset = "00000000-0000-4000-8000-000000000001";
  const walletA = "00000000-0000-4000-8000-000000000002";
  const walletB = "00000000-0000-4000-8000-000000000003";
  const walletC = "00000000-0000-4000-8000-000000000004";
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto','ISOLATED_SQL_TEST','Memory-only fixture')", [asset]);
  await db.query("insert into public.crypto_tokens(asset_id,mint_address,decimals) values($1,'isolated-test-mint',9)", [asset]);
  await db.query("insert into public.wallets(id,address) values($1,'isolated-A'),($2,'isolated-B')", [walletA, walletB]);
  await db.query(`insert into public.wallet_transactions(wallet_id,asset_id,transaction_hash,side,quantity,occurred_at)
    select $1::uuid,$2::uuid,'isolated-old-'||n,'buy',1,'2026-07-01'::timestamptz+n*interval '1 second' from generate_series(1,1205)n`, [walletA, asset]);
  await db.query(`insert into public.wallet_transactions(wallet_id,asset_id,transaction_hash,side,quantity,occurred_at)
    select $1::uuid,$2::uuid,'isolated-new-'||n,'buy',1,'2026-08-01'::timestamptz+n*interval '1 second' from generate_series(1,5)n`, [walletB, asset]);
  const claim = () => db.query("select * from public.claim_wallet_enrichment_targets('fixture','v1',2,now())");
  await db.exec("set role service_role");
  const first = (await claim()).rows;
  assert.equal(first.length, 2);
  assert.deepEqual(new Set(first.map(row => row.wallet_id)), new Set([walletA, walletB]), "new wallets must be visible beyond the first 1000 old transactions");
  const second = (await claim()).rows;
  assert.equal(second.some(row => first.some(before => row.transaction_id === before.transaction_id)), false, "failed attempts rotate rather than selecting the same head forever");
  const claimedA = (await db.query("select * from public.claim_ingestion_subjects('fixture','wallet',1)")).rows[0].subject_id;
  const claimedB = (await db.query("select * from public.claim_ingestion_subjects('fixture','wallet',1)")).rows[0].subject_id;
  assert.notEqual(claimedA, claimedB, "wallet rebuild scheduling rotates persistently");
  await db.query("select * from public.wallet_evidence_missing_window($1)", [asset]);
  await db.exec("reset role");
  await db.query("insert into public.wallets(id,address) values($1,'isolated-C')", [walletC]);
  assert.equal((await db.query("select * from public.claim_ingestion_subjects('fixture','wallet',1)")).rows[0].subject_id, walletC);

  await db.exec(`insert into public.ingestion_runs(job_kind,provider,status,records_processed,started_at) values
    ('stock_quotes','fixture','succeeded',10,'2026-08-01T12:00:00Z'),
    ('stock_quotes','fixture','failed',5,'2026-08-01T13:00:00Z'),
    ('stock_quotes','fixture','succeeded',999,'2026-08-02T00:00:00Z');
    insert into public.provider_errors(provider,error_code,message,retryable,occurred_at) values
    ('fixture','TEST','Memory only',false,'2026-08-01T12:00:00Z'),
    ('fixture','TEST','Excluded boundary',false,'2026-08-02T00:00:00Z');`);
  const summary = (await db.query("select public.data_operations_window_summary('2026-08-01','2026-08-02') result")).rows[0].result;
  assert.equal(summary.records_processed, 15);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.provider_errors, 1);
  await assert.rejects(db.query("select public.data_operations_window_summary('2026-08-01','2026-08-20')"));
  await db.query("select public.wallet_promotion_read_counts()");
  const source = "00000000-0000-4000-8000-000000000005";
  await db.query(`insert into public.forecasts(id,forecast_key,asset_id,forecast_version,forecast_method,model_version,feature_set_version,information_cutoff_at,available_at,horizon,status)
    values($1,'fixture-source',$2,'forecast-infrastructure-v1','INSUFFICIENT_DATA','fixture','fixture',now(),now(),'5m','INSUFFICIENT_DATA')`, [source, asset]);
  for (const version of ["historical-cohort-baseline-v1", "historical-cohort-baseline-v2"]) {
    const pending = (await db.query("select id,asset_kind from public.baseline_forecast_pending_targets_v2 where id=$1", [source])).rows;
    assert.equal(pending.length, 1, "a v1 result must not drain the v2 pending queue");
    assert.equal(pending[0].asset_kind, "crypto");
    await db.query(`insert into public.forecasts(forecast_key,asset_id,forecast_version,forecast_method,model_version,feature_set_version,information_cutoff_at,available_at,horizon,status,agent_inputs)
      values($1,$2,$1,'INSUFFICIENT_DATA','fixture','fixture',now(),now(),'5m','INSUFFICIENT_DATA',jsonb_build_object('sourceForecastId',$3::text))`, [version, asset, source]);
  }
  assert.equal((await db.query("select id from public.baseline_forecast_pending_targets_v2 where id=$1", [source])).rows.length, 1, "partial legacy v2 rows cannot drain the queue");
  assert.equal((await db.query("select id from public.forecasts where forecast_key='historical-cohort-baseline-v1'")).rows.length, 1, "v1 evidence remains intact");

  const sourceTime = (await db.query("select information_cutoff_at::text cutoff from public.forecasts where id=$1", [source])).rows[0].cutoff;
  const forecastId = randomUUID();
  const forecast = {
    id: forecastId, forecast_key: "isolated-atomic-baseline", asset_id: asset,
    forecast_version: "historical-cohort-baseline-v2", forecast_method: "INSUFFICIENT_DATA",
    model_version: "historical-cohort-baseline-v2", feature_set_version: "typed-market-features-v2",
    information_cutoff_at: sourceTime, available_at: sourceTime, horizon: "5m", status: "INSUFFICIENT_DATA",
    evidence_refs: [], agent_inputs: { sourceForecastId: source, sampleSize: 0 },
  };
  const snapshot = {
    snapshot_key: "isolated-atomic-feature", forecast_id: forecastId, asset_id: asset,
    feature_version: "typed-market-features-v2", information_cutoff_at: sourceTime, available_at: sourceTime,
    data_quality: 0, feature_payload: {}, feature_hash: "isolated-feature-hash",
  };
  const event = {
    event_id: randomUUID(), schema_version: 1, event_type: "forecast.baseline_created", entity_type: "forecast",
    entity_id: forecastId, asset_id: asset, occurred_at: sourceTime, observed_at: sourceTime, available_at: sourceTime,
    provider: "baseline-forecast", source_reference: "baseline:isolated-atomic-baseline", data_quality: 0,
    payload: { status: "INSUFFICIENT_DATA", modelVersion: "historical-cohort-baseline-v2" }, payload_hash: "a".repeat(64),
  };
  const persistBundle = (f = forecast, s = snapshot, members = [], e = event, hash = "isolated-bundle-hash") => db.query(
    "select public.persist_baseline_forecast_bundle_v2($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5) result",
    [JSON.stringify(f), JSON.stringify(s), JSON.stringify(members), JSON.stringify(e), hash],
  );
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_function_privilege($1,'public.persist_baseline_forecast_bundle_v2(jsonb,jsonb,jsonb,jsonb,text)','execute') allowed", [role])).rows[0].allowed, false);
  }
  await db.exec("set role service_role");
  // Fail at the LAST insert, after forecast and feature have been attempted.
  await assert.rejects(persistBundle(forecast, snapshot, [], { ...event, schema_version: 0 }));
  assert.equal((await db.query("select id from public.forecasts where id=$1", [forecastId])).rows.length, 0, "outbox failure rolls back the forecast");
  assert.equal((await db.query("select id from public.baseline_feature_snapshots where forecast_id=$1", [forecastId])).rows.length, 0, "outbox failure rolls back the features");
  await assert.rejects(persistBundle({ ...forecast, agent_inputs: { ...forecast.agent_inputs, sampleSize: 1 } }, snapshot, [{
    forecast_id: forecastId, source_observation_id: randomUUID(), anchor_at: "2026-01-01", outcome_at: "2099-01-01",
    available_at: "2099-01-01", return_pct: 1, member_hash: "future-member", feature_distance: 0,
  }]), /BASELINE_COHORT_CUTOFF_VIOLATION/);
  assert.equal((await db.query("select id from public.forecasts where id=$1", [forecastId])).rows.length, 0);
  assert.equal((await persistBundle()).rows[0].result.reused, false);
  assert.equal((await persistBundle()).rows[0].result.reused, true);
  await assert.rejects(persistBundle(forecast, snapshot, [], event, "conflicting-hash"), /BASELINE_BUNDLE_IDENTITY_CONFLICT/);
  assert.equal((await db.query("select id from public.baseline_feature_snapshots where forecast_id=$1", [forecastId])).rows.length, 1);
  assert.equal((await db.query("select event_id from public.event_outbox where entity_id=$1", [forecastId])).rows.length, 1);
  assert.equal((await db.query("select id from public.baseline_forecast_pending_targets_v2 where id=$1", [source])).rows.length, 0);
  await assert.rejects(persistBundle({ ...forecast, forecast_key: "historical-cohort-baseline-v2" }), /BASELINE_LEGACY_PARTIAL_REQUIRES_REVIEW/);
  const stockAsset = randomUUID(), stockSource = randomUUID(), stockForecastId = randomUUID(), candleId = randomUUID();
  const stockCutoff = "2026-08-01T14:00:00Z", anchor = "2026-08-01T13:50:00Z", outcome = "2026-08-01T13:55:00Z";
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'stock','BASELINE_SQL_STOCK','Memory-only stock fixture')", [stockAsset]);
  await db.query(`insert into public.forecasts(id,forecast_key,asset_id,forecast_version,forecast_method,model_version,feature_set_version,information_cutoff_at,available_at,horizon,status)
    values($1,'stock-fixture-source',$2,'forecast-infrastructure-v1','INSUFFICIENT_DATA','fixture','fixture',$3,$3,'5m','INSUFFICIENT_DATA')`, [stockSource, stockAsset, stockCutoff]);
  await db.query(`insert into public.market_candles(id,candle_key,asset_id,provider,timeframe,opened_at,closed_at,observed_at,available_at,open,high,low,close,volume,data_quality)
    values($1,'atomic-stock-candle',$2,'fixture','5m','2026-08-01T13:45:00Z',$3,$3,$3,100,101,99,100,1000,90)`, [candleId, stockAsset, anchor]);
  const stockForecast = { ...forecast, id: stockForecastId, forecast_key: "atomic-stock-result", asset_id: stockAsset,
    information_cutoff_at: stockCutoff, available_at: stockCutoff, agent_inputs: { sourceForecastId: stockSource, sampleSize: 1, assetClass: "STOCK" } };
  const stockSnapshot = { ...snapshot, snapshot_key: "atomic-stock-features", forecast_id: stockForecastId, asset_id: stockAsset, information_cutoff_at: stockCutoff, available_at: stockCutoff };
  const stockEvent = { ...event, event_id: randomUUID(), entity_id: stockForecastId, asset_id: stockAsset, source_reference: "baseline:atomic-stock-result",
    occurred_at: stockCutoff, observed_at: stockCutoff, available_at: stockCutoff };
  const stockMember = { forecast_id: stockForecastId, source_candle_id: candleId, source_observation_id: null,
    anchor_at: anchor, outcome_at: outcome, available_at: outcome, return_pct: 1, feature_distance: 0, member_hash: "atomic-stock-member" };
  await assert.rejects(persistBundle(stockForecast, stockSnapshot, [{ ...stockMember, anchor_at: "2026-08-01T13:49:00Z" }], stockEvent, "stock-bundle"), /BASELINE_CANDLE_SOURCE_MISMATCH/);
  assert.equal((await persistBundle(stockForecast, stockSnapshot, [stockMember], stockEvent, "stock-bundle")).rows[0].result.reused, false);
  assert.equal((await db.query("select source_candle_id,source_observation_id from public.baseline_cohort_members where forecast_id=$1", [stockForecastId])).rows[0].source_candle_id, candleId);
  await db.exec("reset role");
  console.log("Passed: private roles, service-role RPC access, >1000-row wallet fairness, retry rotation, new-wallet priority, exact time-window counts and typed view.");
  console.log("Passed: atomic baseline rollback, PIT rejection, complete-bundle idempotency, identity conflicts and explicit legacy-partial failure.");
  await checkIntelligenceProvenance(db);
    await checkProspectiveStrategyDatasets(db);
  await runDataGapRevisitChecks(db);
  await checkDemoAccountReconciliation(db);
  await checkExecutionFinalGuard(db);
  await checkExecutionFillProvenance(db);
  await checkFrontendPaperSnapshot(db);
  await checkWalletEvidenceWindow(db);
  await checkExecutionReconciliation(db);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await db.close(); }

async function controls() {
  return {
    controls: (await db.query("select control_key,mode,new_orders_enabled,kill_switch,live_execution_enabled,provider,limits from public.execution_controls order by control_key")).rows,
    accounts: (await db.query("select account_key,provider,provider_environment,status from public.execution_accounts order by account_key")).rows,
    jobs: (await db.query("select job_key,enabled from public.scheduled_jobs order by job_key")).rows,
  };
}
