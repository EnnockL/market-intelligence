/** Disposable PostgreSQL only. Caller owns setup; no env or remote connections. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkExecutionReconciliation(db) {
  const signature = "public.persist_execution_order_observation(uuid,text,text,text,text,bigint,jsonb)";
  for (const role of ["anon", "authenticated"]) assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') allowed", [signature])).rows[0].allowed, true);
  const asset = randomUUID();
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Memory-only reconciliation fixture')", [asset, `RECON_${asset.slice(0, 8)}`]);
  await db.exec(`create function public.reconciliation_fixture_reject_event() returns trigger language plpgsql as $$
    begin if current_setting('test.execution_reconciliation_reject',true)='yes' and new.payload->>'version'='execution-order-observation-v1'
      then raise exception 'ISOLATED_AUDIT_WRITE_FAILURE'; end if; return new; end; $$;
    create trigger reconciliation_fixture_reject_event before insert on public.execution_order_events
      for each row execute function public.reconciliation_fixture_reject_event();`);
  let tick = Date.now() - 3_600_000;
  const nextTime = () => new Date(tick += 1000).toISOString();
  await db.exec("set role service_role");
  try {
    async function fixture(options = {}) {
      const f = { order: randomUUID(), intent: randomUUID(), safety: randomUUID(), provider: options.provider ?? "okx-demo", mode: options.mode ?? "DEMO", revision: 0 };
      f.client = `recon-${f.order}`; f.providerId = `provider-${f.order}`; f.observedAt = nextTime();
      await db.query(`insert into public.execution_intents(id,intent_key,contract_version,source_type,source_id,asset_id,instrument_id,side,order_type,quote_amount_sek,quantity,max_slippage_bps,information_cutoff_at,available_at,expires_at,evidence_refs,payload_hash)
        values($1,$2,'execution-contract-v1','fixture','fixture',$3,'BTC-USDT','BUY','LIMIT',100,$4,25,$5,$5,clock_timestamp()+interval '1 minute','[]','fixture')`, [f.intent, `recon-${f.intent}`, asset, options.requestedQuantity === undefined ? 3 : options.requestedQuantity, f.observedAt]);
      await db.query(`insert into public.execution_safety_evaluations(id,evaluation_key,intent_id,policy_version,decision,requirements,context,limits,result_hash,information_cutoff_at,available_at)
        values($1,$2,$3,'execution-safety-policy-v2','PASSED','[]','{}','{}','fixture',$4,$4)`, [f.safety, `recon-${f.safety}`, f.intent, f.observedAt]);
      await db.query(`insert into public.execution_orders(id,intent_id,safety_evaluation_id,provider,provider_environment,client_order_id,provider_order_id,current_state,filled_quantity,average_price,last_provider_observed_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [f.order, f.intent, f.safety, f.provider, f.mode, f.client,
        options.providerIdMissing ? null : f.providerId, options.state ?? "PARTIALLY_FILLED", options.filledQuantity ?? 1,
        options.averagePrice === undefined ? 100 : options.averagePrice, f.observedAt]);
      return f;
    }
    function observation(f, overrides = {}) {
      return { version: "execution-order-observation-v1", providerOrderId: f.providerId, clientOrderId: f.client,
        state: "PARTIALLY_FILLED", filledQuantity: 2, averagePrice: 100, observedAt: nextTime(), ...overrides };
    }
    async function persist(f, value, revision = f.revision) {
      return (await db.query("select public.persist_execution_order_observation($1,$2,$3,'BTC-USDT',$4,$5,$6::jsonb) result", [f.order, f.provider, f.mode, f.client, revision, value === null ? null : JSON.stringify(value)])).rows[0].result;
    }
    async function state(f) {
      return (await db.query("select current_state,filled_quantity::text,average_price::text,provider_order_id,last_provider_observed_at::text,reconciliation_revision from public.execution_orders where id=$1", [f.order])).rows[0];
    }
    const eventCount = async f => (await db.query("select count(*)::integer count from public.execution_order_events where order_id=$1", [f.order])).rows[0].count;
    async function reject(f, value, reason, revision = f.revision) {
      const before = await state(f), count = await eventCount(f);
      assert.deepEqual(await persist(f, value, revision), { status: "REJECTED", reason });
      assert.deepEqual(await state(f), before, reason); assert.equal(await eventCount(f), count, "a rejected observation appends no false event");
    }

    const partial = await fixture(), partialObservation = observation(partial);
    assert.equal((await persist(partial, partialObservation)).status, "APPLIED");
    assert.equal((await state(partial)).filled_quantity, "2");
    assert.equal((await state(partial)).current_state, "PARTIALLY_FILLED");
    assert.equal(await eventCount(partial), 1);
    const event = (await db.query("select previous_state,next_state,reason,payload from public.execution_order_events where order_id=$1", [partial.order])).rows[0];
    assert.equal(event.previous_state, "PARTIALLY_FILLED"); assert.equal(event.next_state, "PARTIALLY_FILLED");
    assert.equal(event.payload.filledQuantity, 2);
    assert.equal((await persist(partial, partialObservation)).status, "DUPLICATE");
    assert.equal(await eventCount(partial), 1); assert.equal(Number((await state(partial)).reconciliation_revision), 1);
    await reject(partial, observation(partial, { filledQuantity: 3, state: "FILLED" }), "ORDER_CHANGED_DURING_READ");
    assert.equal((await persist(partial, observation(partial, { filledQuantity: 3, state: "FILLED" }), 1)).status, "APPLIED");
    await reject(partial, observation(partial), "ORDER_TERMINAL_OR_NOT_SUBMITTED", 2);
    assert.equal((await persist(partial, partialObservation)).status, "DUPLICATE", "an old retry cannot regress a terminal order");
    assert.equal((await state(partial)).current_state, "FILLED"); assert.equal(await eventCount(partial), 2);

    for (const [change, reason] of [
      [{ filledQuantity: -1 }, "OBSERVATION_INVALID"], [{ filledQuantity: "2" }, "OBSERVATION_INVALID"],
      [{ filledQuantity: 4 }, "FILL_QUANTITY_CONFLICT"], [{ filledQuantity: 0, averagePrice: null, state: "ACKNOWLEDGED" }, "FILL_QUANTITY_CONFLICT"],
      [{ filledQuantity: 3 }, "FILL_QUANTITY_CONFLICT"], [{ state: "FILLED", filledQuantity: 2 }, "FILL_QUANTITY_CONFLICT"],
      [{ state: "REJECTED", filledQuantity: 2 }, "FILL_QUANTITY_CONFLICT"],
      [{ filledQuantity: 1, averagePrice: 101 }, "AVERAGE_PRICE_CORRECTION_UNVERIFIED"],
      [{ averagePrice: null }, "OBSERVATION_INVALID"], [{ state: "UNKNOWN" }, "OBSERVATION_INVALID"],
      [{ providerOrderId: "other" }, "OBSERVATION_INVALID"], [{ clientOrderId: "other" }, "OBSERVATION_INVALID"],
      [{ observedAt: "infinity" }, "OBSERVATION_INVALID"], [{ observedAt: "invalid" }, "OBSERVATION_INVALID"],
    ]) {
      const f = await fixture(); await reject(f, observation(f, change), reason);
    }
    const future = await fixture(); await reject(future, observation(future, { observedAt: new Date(Date.now() + 60_000).toISOString() }), "OBSERVATION_INVALID");
    const stale = await fixture(); await reject(stale, observation(stale, { observedAt: stale.observedAt }), "OBSERVATION_NOT_NEWER");
    await reject(stale, observation(stale, { observedAt: new Date(Date.parse(stale.observedAt) - 1000).toISOString() }), "OBSERVATION_NOT_NEWER");
    assert.equal((await persist(stale, observation(stale, { filledQuantity: 1, observedAt: stale.observedAt }))).status, "UNCHANGED");
    assert.equal(await eventCount(stale), 0);
    for (const terminal of ["FILLED", "CANCELLED", "REJECTED", "CLOSED", "BLOCKED", "MANUAL_INTERVENTION", "SAFETY_PASSED"]) {
      const f = await fixture({ state: terminal }); await reject(f, observation(f), "ORDER_TERMINAL_OR_NOT_SUBMITTED");
    }
    const cancelled = await fixture();
    assert.equal((await persist(cancelled, observation(cancelled, { state: "CANCELLED", filledQuantity: 2 }))).status, "APPLIED");
    assert.equal((await state(cancelled)).filled_quantity, "2", "cancelled partial quantities must not disappear");
    const absent = await fixture(); const beforeAbsent = await state(absent);
    assert.equal((await persist(absent, null)).status, "UNRESOLVED");
    assert.equal((await state(absent)).current_state, "RECONCILIATION_REQUIRED");
    assert.equal((await state(absent)).filled_quantity, beforeAbsent.filled_quantity);
    assert.equal((await state(absent)).last_provider_observed_at, beforeAbsent.last_provider_observed_at);
    assert.equal((await persist(absent, null)).status, "DUPLICATE"); assert.equal(await eventCount(absent), 1);
    await reject(absent, observation(absent, { providerOrderId: "contradictory-order" }), "OBSERVATION_INVALID", 1);
    const submitting = await fixture({ state: "SUBMITTING", filledQuantity: 0, averagePrice: null, providerIdMissing: true });
    assert.equal((await persist(submitting, observation(submitting, { state: "FILLED", filledQuantity: 3 }))).status, "APPLIED");
    assert.equal((await state(submitting)).provider_order_id, submitting.providerId, "recovery retains exact provider order identity");
    const shadow = await fixture({ provider: "shadow-execution", mode: "SHADOW", state: "ACKNOWLEDGED", filledQuantity: 0, averagePrice: null, requestedQuantity: null });
    assert.equal((await persist(shadow, observation(shadow, { state: "ACKNOWLEDGED", filledQuantity: 0, averagePrice: null }))).status, "APPLIED");
    const unbounded = await fixture({ requestedQuantity: null }); await reject(unbounded, observation(unbounded), "FILL_QUANTITY_CONFLICT");

    const changed = await fixture();
    await db.query("update public.execution_orders set updated_at=clock_timestamp() where id=$1", [changed.order]);
    await reject(changed, observation(changed), "ORDER_CHANGED_DURING_READ");
    const racing = await fixture(), racingObservation = observation(racing);
    const races = await Promise.all([persist(racing, racingObservation), persist(racing, racingObservation)]);
    assert.deepEqual(races.map(result => result.status).sort(), ["APPLIED", "DUPLICATE"]);
    assert.equal(await eventCount(racing), 1, "simultaneous replay is idempotent (PGlite serializes its connection)");
    const rollback = await fixture(), rollbackBefore = await state(rollback);
    await db.exec("set test.execution_reconciliation_reject='yes'");
    await assert.rejects(persist(rollback, observation(rollback)), /ISOLATED_AUDIT_WRITE_FAILURE/);
    await db.exec("set test.execution_reconciliation_reject='no'");
    assert.deepEqual(await state(rollback), rollbackBefore, "audit failure rolls back order and revision together");
    assert.equal(await eventCount(rollback), 0);
    assert.equal((await db.query("select count(*)::integer count from public.execution_fills where order_id in (select id from public.execution_orders where client_order_id like 'recon-%')")).rows[0].count, 0, "observations never fabricate execution_fills");
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select public.persist_execution_order_observation($1,'okx-demo','DEMO','BTC-USDT',$2,0,null)", [partial.order, partial.client]), error => error.code === "42501");
  } finally {
    await db.exec("reset role; set test.execution_reconciliation_reject='no'; drop trigger reconciliation_fixture_reject_event on public.execution_order_events; drop function public.reconciliation_fixture_reject_event()");
  }
  console.log("Execution reconciliation: atomic observations, quantity/state/revision guards, replay, role isolation and rollback passed.");
}
