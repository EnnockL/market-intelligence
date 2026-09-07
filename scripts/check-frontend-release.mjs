/**
 * Standalone frontend-release SQL verification in disposable memory-only PGlite.
 * Applies the existing 0001-0080 schema, then ONLY 0081, 0083 and 0091.
 * Does not read environment files, create a network client or use production.
 *
 * node scripts/check-frontend-release.mjs <temporary-directory>/node_modules/@electric-sql/pglite
 * The optional module path is a local package directory, never a database URL.
 * This is not a substitute for a Supabase staging/HTTP-role smoke test.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkFrontendPaperSnapshot } from "./check-frontend-paper-snapshot.mjs";

const releaseFiles = [
  "0081_private_execution_access.sql",
  "0083_public_read_truth.sql",
  "0091_frontend_paper_snapshot.sql",
];
const privateTables = [
  "execution_controls", "execution_control_revisions", "execution_intents",
  "execution_safety_evaluations", "execution_orders", "execution_order_events",
  "execution_fills", "execution_reconciliation_runs", "execution_accounts",
  "account_state_observations", "risk_ledger_snapshots", "execution_bridge_attempts",
  "trade_proposals", "trade_eligibility_evaluations", "trade_proposal_producer_evaluations",
  "scheduled_jobs", "scheduled_job_runs", "ingestion_runs", "provider_errors",
];
const functions = [
  { signature: "public.data_operations_window_summary(timestamptz,timestamptz)", call: "public.data_operations_window_summary('2026-08-01','2026-08-02')" },
  { signature: "public.wallet_promotion_read_counts()", call: "public.wallet_promotion_read_counts()" },
  { signature: "public.frontend_paper_snapshot_v1()", call: "public.frontend_paper_snapshot_v1()" },
];

const modulePath = process.argv[2];
const { PGlite } = await import(modulePath ? pathToFileURL(join(modulePath, "dist/index.js")).href : "@electric-sql/pglite");
const { pgcrypto } = await import(modulePath ? pathToFileURL(join(modulePath, "dist/contrib/pgcrypto.js")).href : "@electric-sql/pglite/contrib/pgcrypto");
const db = new PGlite({ extensions: { pgcrypto } });
const migrations = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

async function apply(file) {
  // Earlier schema installed pgcrypto in public; hosted schema moved it before
  // the existing 0064 trigger repair. Match that established bootstrap here.
  if (file.startsWith("0064_")) await db.exec("alter extension pgcrypto set schema extensions; set search_path=public,extensions");
  try { await db.exec(await readFile(join(migrations, file), "utf8")); }
  catch (error) { throw new Error(`${file}: ${error.code} ${error.message}`); }
}

async function executionAndSchedulerState() {
  return (await db.query(`select jsonb_build_object(
    'controls',(select coalesce(jsonb_agg(to_jsonb(c) order by c.control_key),'[]'::jsonb) from public.execution_controls c),
    'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]'::jsonb) from public.scheduled_jobs j),
    'orders',(select count(*) from public.execution_orders),
    'intents',(select count(*) from public.execution_intents)
  ) value`)).rows[0].value;
}

async function checkPrivateAccess() {
  for (const table of privateTables) {
    assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].enabled, true, `${table} RLS is enabled`);
    const policies = (await db.query(`select policyname from pg_policies where schemaname='public' and tablename=$1
      and roles && array['public','anon','authenticated']::name[]`, [table])).rows;
    assert.deepEqual(policies, [], `${table} has no generic public/authenticated policy`);
    assert.equal((await db.query("select has_table_privilege('service_role',$1,'select') allowed", [`public.${table}`])).rows[0].allowed, true);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("select has_table_privilege($1,$2,'select') allowed", [role, `public.${table}`])).rows[0].allowed, false, `${role} cannot read ${table}`);
    }
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of privateTables) await assert.rejects(db.query(`select * from public.${table} limit 1`), error => error.code === "42501");
      for (const entry of functions) await assert.rejects(db.query(`select ${entry.call}`), error => error.code === "42501");
    } finally { await db.exec("reset role"); }
  }
  for (const entry of functions) {
    const definition = (await db.query("select provolatile,prosecdef from pg_proc where oid=$1::regprocedure", [entry.signature])).rows[0];
    assert.deepEqual(definition, { provolatile: "s", prosecdef: false }, `${entry.signature} is stable/security-invoker`);
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') allowed", [entry.signature])).rows[0].allowed, true);
  }
  await db.exec("set role service_role");
  try {
    for (const table of privateTables) await db.query(`select * from public.${table} limit 1`);
    for (const entry of functions) await db.query(`select ${entry.call}`);
  } finally { await db.exec("reset role"); }
  console.log("Passed: 19 private tables deny anon/authenticated reads; service-role access and all three read-only RPC contracts remain available.");
}

async function checkReadTruth() {
  await db.exec("begin");
  try {
    await db.exec(`insert into public.ingestion_runs(job_kind,provider,status,records_processed,started_at) values
      ('stock_quotes','frontend-fixture','succeeded',1000,'2026-07-31T23:59:59Z'),
      ('stock_quotes','frontend-fixture','succeeded',10,'2026-08-01T00:00:00Z'),
      ('stock_quotes','frontend-fixture','failed',5,'2026-08-01T13:00:00Z'),
      ('stock_quotes','frontend-fixture','succeeded',999,'2026-08-02T00:00:00Z');
      insert into public.provider_errors(provider,error_code,message,retryable,occurred_at) values
      ('frontend-fixture','TEST','Excluded lower boundary',false,'2026-07-31T23:59:59Z'),
      ('frontend-fixture','TEST','Memory-only detail must not be in public DTO',false,'2026-08-01T00:00:00Z'),
      ('frontend-fixture','TEST','Excluded upper boundary',false,'2026-08-02T00:00:00Z');`);
    const statuses = ["candidate", "tracked", "reviewing", "verified", "rejected"];
    const before = (await db.query("select public.wallet_promotion_read_counts() value")).rows[0].value;
    for (const status of statuses) await db.query(`insert into public.wallet_discovery_candidates(address,provider,status,score,data_quality,last_observed_at)
      values($1,'frontend-fixture',$2,50,50,'2026-08-01')`, [`frontend-${randomUUID()}`, status]);
    await db.exec("set local role service_role");
    const summary = (await db.query("select public.data_operations_window_summary('2026-08-01T00:00:00Z','2026-08-02T00:00:00Z') value")).rows[0].value;
    assert.deepEqual(Object.keys(summary).sort(), ["records_processed", "succeeded", "failed", "provider_errors", "since", "until"].sort());
    assert.equal(summary.records_processed, 15); assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1); assert.equal(summary.provider_errors, 1);
    const empty = (await db.query("select public.data_operations_window_summary('2025-01-01T00:00:00Z','2025-01-02T00:00:00Z') value")).rows[0].value;
    for (const field of ["records_processed", "succeeded", "failed", "provider_errors"]) assert.equal(empty[field], 0, "a successful empty read is an actual zero");
    const counts = (await db.query("select public.wallet_promotion_read_counts() value")).rows[0].value;
    assert.deepEqual(Object.keys(counts).sort(), ["total", ...statuses].sort());
    assert.equal(counts.total, before.total + statuses.length);
    for (const status of statuses) assert.equal(counts[status], before[status] + 1);
    // Exactly seven days is permitted; malformed/reversed/oversized windows
    // fail, and must never be turned into successful empty summaries by callers.
    await db.query("select public.data_operations_window_summary('2026-08-01T00:00:00Z','2026-08-08T00:00:00Z')");
  } finally { await db.exec("reset role; rollback"); }
  await db.exec("set role service_role");
  try {
    for (const [since, until] of [[null, "2026-08-02"], ["2026-08-01", null], ["2026-08-01", "2026-08-01"], ["2026-08-02", "2026-08-01"], ["2026-08-01", "2026-08-09"]]) {
      await assert.rejects(db.query("select public.data_operations_window_summary($1,$2)", [since, until]), /valid window of at most seven days/);
    }
  } finally { await db.exec("reset role"); }
  console.log("Passed: exact inclusive/exclusive window counts, failed-run totals, successful-empty zeros, invalid-window rejection and complete wallet promotion counts.");
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    alter default privileges in schema public grant all on tables to service_role;`);
  const files = (await readdir(migrations)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort();
  const baseline = files.filter(file => Number(file.slice(0, 4)) <= 80);
  assert.deepEqual(baseline.map(file => Number(file.slice(0, 4))), Array.from({ length: 80 }, (_, i) => i + 1), "release test requires the exact existing 0001-0080 schema");
  for (const file of releaseFiles) assert.ok(files.includes(file), `Missing selected release migration ${file}`);
  for (const file of baseline) await apply(file);
  const before = await executionAndSchedulerState();
  for (const file of releaseFiles) await apply(file);
  assert.deepEqual(await executionAndSchedulerState(), before, "frontend migrations must not change execution controls, jobs, orders or intents");
  console.log(`Applied ${baseline.length + releaseFiles.length} migrations to disposable PostgreSQL: 0001-0080, ${releaseFiles.map(file => file.slice(0, 4)).join(", ")}.`);
  await checkPrivateAccess();
  await checkReadTruth();
  await checkFrontendPaperSnapshot(db);
  console.log("Frontend-only SQL release passed without the deferred backend migrations or modules.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await db.close(); }
