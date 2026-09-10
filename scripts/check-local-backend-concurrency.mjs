/**
 * Real multi-connection PostgreSQL regression test for migration 0092.
 *
 * Usage: node scripts/check-local-backend-concurrency.mjs <absolute-pg-module-path> --allow-local-writes
 *
 * Only the dedicated local Supabase project below is accepted. This script does
 * not load application env files, accept connection URLs, contact providers,
 * authorize trading, or start workers. It creates and removes only its own
 * randomly identified fixtures. The caller must apply migrations first.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PROJECT = "market-intelligence-backend-local";
const CONTAINER = `supabase_db_${PROJECT}`;
const HOST = "127.0.0.1";
const PORT = 57422;
const [driverPath, acknowledgement, ...extra] = process.argv.slice(2);
assert.ok(driverPath && isAbsolute(driverPath), "An absolute path to the disposable pg installation is required.");
assert.equal(acknowledgement, "--allow-local-writes", "Explicit acknowledgement of local fixture writes is required.");
assert.equal(extra.length, 0, "Connection URLs and extra arguments are not supported.");

// Inspect just the named container; never enumerate or print environment values.
const inspection = spawnSync("docker", ["inspect", CONTAINER], {
  encoding: "utf8", timeout: 10_000, windowsHide: true,
});
assert.equal(inspection.status, 0, "The dedicated local Supabase database container must be running.");
const [container] = JSON.parse(inspection.stdout);
assert.equal(container.Name, `/${CONTAINER}`, "Unexpected local container identity.");
assert.equal(container.State?.Running, true, "The local database container is not running.");
assert.equal(container.Config?.Labels?.["com.supabase.cli.project"], PROJECT, "Unexpected Supabase project label.");
assert.ok(container.NetworkSettings?.Ports?.["5432/tcp"]?.some(binding =>
  binding.HostPort === String(PORT) && [HOST, "0.0.0.0"].includes(binding.HostIp)),
"The dedicated database must expose its PostgreSQL port on the fixed local test port.");

const { Client } = createRequire(import.meta.url)(resolve(driverPath));
const run = randomUUID();
const prefix = `local-concurrency-${run}`;
const clients = [];
const fixtures = [];
const asset = randomUUID();
const triggerName = `local_recon_reject_${run.replaceAll("-", "")}`;
let assetCreated = false;
let triggerCreated = false;
let observer;
let connectionA;
let connectionB;
let pending = [];
let tick = Date.now() - 3_600_000;
const nextTime = () => new Date(tick += 1000).toISOString();
const results = [];

async function connect(suffix) {
  // Every connection field is explicit: PGHOST/PGPORT/DATABASE_URL cannot redirect
  // this runner. "postgres" is the disposable local CLI database password only.
  const client = new Client({
    host: HOST, port: PORT, database: "postgres", user: "postgres", password: "postgres",
    ssl: false, application_name: `${prefix}-${suffix}`,
    connectionTimeoutMillis: 5000,
    options: "-c statement_timeout=12000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=15000",
  });
  clients.push(client);
  await client.connect();
  const identity = (await client.query("select current_database() name, current_user username, pg_backend_pid() pid")).rows[0];
  assert.equal(identity.name, "postgres");
  assert.equal(identity.username, "postgres");
  client.fixturePid = identity.pid;
  return client;
}

async function fixture() {
  const f = { order: randomUUID(), intent: randomUUID(), safety: randomUUID(), stamp: nextTime() };
  f.client = `${prefix}-${f.order}`;
  f.providerId = `local-provider-${f.order}`;
  // Record the identities before writes so even partially prepared fixtures are
  // cleaned up. No existing application rows match these generated UUIDs.
  fixtures.push(f);
  await observer.query(`insert into public.execution_intents
    (id,intent_key,contract_version,source_type,source_id,asset_id,instrument_id,side,order_type,
     quote_amount_sek,quantity,max_slippage_bps,information_cutoff_at,available_at,expires_at,evidence_refs,payload_hash)
    values($1,$2,'execution-contract-v1','local-concurrency-fixture',$2,$3,'BTC-USDT','BUY','LIMIT',
     100,3,25,$4,$4,clock_timestamp()+interval '1 hour','[]',$2)`, [f.intent, `${prefix}-${f.intent}`, asset, f.stamp]);
  await observer.query(`insert into public.execution_safety_evaluations
    (id,evaluation_key,intent_id,policy_version,decision,requirements,context,limits,result_hash,information_cutoff_at,available_at)
    values($1,$2,$3,'execution-safety-policy-v1','PASSED','[]','{}','{}',$2,$4,$4)`,
  [f.safety, `${prefix}-${f.safety}`, f.intent, f.stamp]);
  await observer.query(`insert into public.execution_orders
    (id,intent_id,safety_evaluation_id,provider,provider_environment,client_order_id,provider_order_id,
     current_state,filled_quantity,average_price,last_provider_observed_at)
    values($1,$2,$3,'okx-demo','DEMO',$4,$5,'PARTIALLY_FILLED',1,100,$6)`,
  [f.order, f.intent, f.safety, f.client, f.providerId, f.stamp]);
  return f;
}

function observation(f, overrides = {}) {
  return { version: "execution-order-observation-v1", providerOrderId: f.providerId,
    clientOrderId: f.client, state: "PARTIALLY_FILLED", filledQuantity: 2,
    averagePrice: 100, observedAt: nextTime(), ...overrides };
}

async function persist(client, f, value, revision = 0) {
  return (await client.query(`select public.persist_execution_order_observation(
    $1,'okx-demo','DEMO','BTC-USDT',$2,$3,$4::jsonb) result`,
  [f.order, f.client, revision, JSON.stringify(value)])).rows[0].result;
}

async function state(f) {
  return (await observer.query(`select current_state,filled_quantity::text,average_price::text,
    reconciliation_revision::text,last_provider_observed_at::text
    from public.execution_orders where id=$1`, [f.order])).rows[0];
}

async function eventCount(f) {
  return (await observer.query("select count(*)::integer count from public.execution_order_events where order_id=$1", [f.order])).rows[0].count;
}

function track(promise) {
  // Attach rejection handling immediately while a separate observer checks the
  // lock. Never turn an asynchronous database error into an unhandled rejection.
  const tracked = promise.then(value => ({ value }), error => ({ error }));
  pending.push(tracked);
  return tracked;
}

async function outcome(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.value;
}

async function waitForBlocked(waiter, blocker) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const row = (await observer.query(`select state,wait_event_type,
      $2::integer=any(pg_blocking_pids(pid)) blocked_by_expected
      from pg_stat_activity where pid=$1`, [waiter.fixturePid, blocker.fixturePid])).rows[0];
    if (row?.state === "active" && row.wait_event_type === "Lock" && row.blocked_by_expected) return;
    await delay(25);
  }
  assert.fail("The second real connection was not observed waiting on the first connection's row lock.");
}

async function lock(client, f) {
  await client.query("begin");
  await client.query("select id from public.execution_orders where id=$1 for update", [f.order]);
}

async function cleanup() {
  // Roll back held locks before waiting for the bounded in-flight queries.
  await Promise.allSettled([connectionA, connectionB].filter(Boolean).map(client => client.query("rollback")));
  await Promise.allSettled(pending);
  if (!observer) return;
  await observer.query("begin");
  try {
    if (triggerCreated) {
      await observer.query(`drop trigger ${triggerName} on public.execution_order_events; drop function public.${triggerName}()`);
    }
    if (fixtures.length) {
      const orders = fixtures.map(f => f.order), intents = fixtures.map(f => f.intent), safety = fixtures.map(f => f.safety);
      // History is immutable in application operation. Only these private test
      // fixtures are removed, by the local test superuser, in this transaction.
      // The setting automatically resets at commit/rollback and affects no other
      // session. No application constraint, trigger definition, or policy changes.
      await observer.query("set local session_replication_role='replica'");
      await observer.query("delete from public.execution_fills where order_id=any($1::uuid[])", [orders]);
      await observer.query("delete from public.execution_order_events where order_id=any($1::uuid[])", [orders]);
      await observer.query("delete from public.execution_orders where id=any($1::uuid[])", [orders]);
      await observer.query("delete from public.execution_safety_evaluations where id=any($1::uuid[])", [safety]);
      await observer.query("delete from public.execution_intents where id=any($1::uuid[])", [intents]);
    }
    if (assetCreated) await observer.query("delete from public.assets where id=$1", [asset]);
    await observer.query("commit");
    triggerCreated = false;
    assetCreated = false;
  } catch (error) {
    await observer.query("rollback");
    throw error;
  }
}

try {
  observer = await connect("observer");
  assert.ok((await observer.query(`select to_regprocedure(
    'public.persist_execution_order_observation(uuid,text,text,text,text,bigint,jsonb)') name`)).rows[0].name,
  "Migration 0092 must be applied before the local concurrency check.");
  // Verify cleanup permission before committing any fixture. This setting is
  // scoped to an empty, rolled-back test transaction and is never left enabled.
  await observer.query("begin");
  await observer.query("set local session_replication_role='replica'");
  await observer.query("rollback");
  const controlsBefore = (await observer.query("select to_jsonb(c) row from public.execution_controls c order by control_key")).rows;
  connectionA = await connect("A");
  connectionB = await connect("B");
  assert.equal(new Set(clients.map(client => client.fixturePid)).size, 3, "Three independent PostgreSQL connections are required.");
  await connectionA.query("set role service_role");
  await connectionB.query("set role service_role");
  await observer.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Disposable local concurrency fixture')",
    [asset, `LOCAL_RECON_${run.slice(0, 8)}`]);
  assetCreated = true;

  const cas = await fixture();
  const firstObservation = observation(cas);
  const secondObservation = observation(cas, { state: "FILLED", filledQuantity: 3 });
  const casBefore = await state(cas);
  await lock(connectionA, cas);
  const competing = track(persist(connectionB, cas, secondObservation));
  await waitForBlocked(connectionB, connectionA);
  assert.equal((await persist(connectionA, cas, firstObservation)).status, "APPLIED");
  assert.deepEqual(await state(cas), casBefore, "An uncommitted order change is not visible on an independent connection.");
  assert.equal(await eventCount(cas), 0, "The uncommitted audit event is not visible either.");
  await connectionA.query("commit");
  assert.deepEqual(await outcome(competing), { status: "REJECTED", reason: "ORDER_CHANGED_DURING_READ" });
  assert.equal((await state(cas)).reconciliation_revision, "1");
  assert.equal((await state(cas)).filled_quantity, "2");
  assert.equal(await eventCount(cas), 1);
  assert.equal((await persist(connectionB, cas, secondObservation, 1)).status, "APPLIED");
  assert.equal((await state(cas)).current_state, "FILLED");
  assert.equal((await state(cas)).reconciliation_revision, "2");
  assert.equal(await eventCount(cas), 2);
  assert.equal((await persist(connectionA, cas, firstObservation)).status, "DUPLICATE");
  assert.equal((await state(cas)).current_state, "FILLED", "An older replay never regresses the terminal observation.");
  results.push("observed row lock; stale competing CAS rejected; fresh revision retry applied; old replay harmless");

  const replay = await fixture();
  const identicalObservation = observation(replay);
  await lock(connectionA, replay);
  const replayPending = track(persist(connectionB, replay, identicalObservation));
  await waitForBlocked(connectionB, connectionA);
  assert.equal((await persist(connectionA, replay, identicalObservation)).status, "APPLIED");
  await connectionA.query("commit");
  assert.equal((await outcome(replayPending)).status, "DUPLICATE");
  assert.equal(await eventCount(replay), 1);
  assert.equal((await state(replay)).reconciliation_revision, "1");
  results.push("simultaneous identical observations produce exactly one revision and one audit event");

  // Reject only this run's event and only the explicitly armed connection. The
  // trigger is temporary test instrumentation, dropped during cleanup.
  await observer.query(`create function public.${triggerName}() returns trigger language plpgsql as $$
    begin
      if current_setting('test.local_backend_reject',true)='${run}'
        and new.payload->>'version'='execution-order-observation-v1'
      then raise exception 'LOCAL_CONCURRENCY_AUDIT_FAILURE'; end if;
      return new;
    end; $$;
    create trigger ${triggerName} before insert on public.execution_order_events
      for each row execute function public.${triggerName}()`);
  triggerCreated = true;
  const rollback = await fixture();
  const rollbackBefore = await state(rollback);
  const rejectedObservation = observation(rollback);
  const recoveredObservation = observation(rollback, { averagePrice: 101 });
  await lock(connectionA, rollback);
  await connectionA.query("select set_config('test.local_backend_reject',$1,true)", [run]);
  const recovery = track(persist(connectionB, rollback, recoveredObservation));
  await waitForBlocked(connectionB, connectionA);
  await assert.rejects(persist(connectionA, rollback, rejectedObservation), error =>
    error.code === "P0001" && error.message === "LOCAL_CONCURRENCY_AUDIT_FAILURE");
  await connectionA.query("rollback");
  assert.equal((await outcome(recovery)).status, "APPLIED", "A waiting valid writer can apply revision zero after the competing audit failure.");
  const recovered = await state(rollback);
  assert.equal(rollbackBefore.filled_quantity, "1");
  assert.equal(recovered.filled_quantity, "2");
  assert.equal(recovered.average_price, "101");
  assert.equal(recovered.reconciliation_revision, "1", "The failed order update did not consume a revision.");
  assert.equal(await eventCount(rollback), 1);
  const onlyEvent = (await observer.query("select payload from public.execution_order_events where order_id=$1", [rollback.order])).rows[0].payload;
  assert.equal(onlyEvent.averagePrice, 101, "Only the successful observation is recorded, not the rolled-back audit.");
  results.push("audit exception rolls back order and revision; a genuinely blocked writer subsequently succeeds");

  assert.equal((await observer.query("select count(*)::integer count from public.execution_fills where order_id=any($1::uuid[])",
    [fixtures.map(f => f.order)])).rows[0].count, 0, "Observation persistence never creates execution fills.");
  assert.deepEqual((await observer.query("select to_jsonb(c) row from public.execution_controls c order by control_key")).rows,
    controlsBefore, "No trading controls or risk limits were changed.");
  await cleanup();
  assert.equal((await observer.query("select count(*)::integer count from public.execution_orders where id=any($1::uuid[])",
    [fixtures.map(f => f.order)])).rows[0].count, 0);
  triggerCreated = false;
  assetCreated = false;
  fixtures.length = 0;
  console.log(JSON.stringify({ status: "PASSED", target: `${HOST}:${PORT}`, project: PROJECT,
    independentConnections: 3, checks: results, fixturesRemoved: true, providerCalls: 0, tradingControlsChanged: false }, null, 2));
} catch (error) {
  try { await cleanup(); } catch (cleanupError) {
    console.error("Local fixture cleanup failed:", cleanupError.code ?? cleanupError.name);
  }
  throw error;
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
}
