import { checkDemoTrialGuard } from "./check-demo-trial-guard.mjs";
/** Memory-only PostgreSQL helper, called by check-data-value-migrations.mjs.
 * No environment files, provider clients, orders or remote connections.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkExecutionFinalGuard(db) {
  const asset = randomUUID();
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Isolated execution fixture')", [asset, `FINAL_${asset.slice(0, 8)}`]);
  const signature = "public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb)";
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege($1,'public.deny_execution_submission(uuid,text)','execute') allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') allowed", [signature])).rows[0].allowed, true);

  const undeclared = randomUUID();
  await db.query("insert into public.execution_accounts(id,account_key,provider,provider_environment,status,initial_cash_sek) values($1,$2,'shadow-execution','SHADOW','ACTIVE',1000)", [undeclared, `undeclared-${undeclared}`]);
  assert.deepEqual((await db.query("select ledger_opening_status,ledger_baseline_at,ledger_history_verified_through,ledger_history_reference from public.execution_accounts where id=$1", [undeclared])).rows[0], {
    ledger_opening_status: "UNKNOWN", ledger_baseline_at: null, ledger_history_verified_through: null, ledger_history_reference: null,
  }, "a legacy cash value does not declare an opening account state");

  await db.exec("set role service_role");
  try {
  async function fixture(mode = "SHADOW", options = {}) {
    const provider = mode === "SHADOW" ? "shadow-execution" : "okx-demo", accountKey = mode === "SHADOW" ? "shadow-primary" : `${provider}-primary`;
    await db.query("update public.execution_controls set mode=$1,provider=$2,kill_switch=false,new_orders_enabled=true,live_execution_enabled=false,provider_status='HEALTHY' where control_key='global'", [mode, provider]);
    await db.query(`insert into public.execution_accounts(account_key,provider,provider_environment,status,initial_cash_sek,
      ledger_opening_status,ledger_baseline_at,ledger_history_verified_through,ledger_history_reference)
      values($1,$2,$3,'ACTIVE',1000,'DECLARED',clock_timestamp()-interval '1 day',clock_timestamp(),'EXPLICIT_MEMORY_ONLY_FIXTURE')
      on conflict(account_key) do update set status='ACTIVE',ledger_opening_status='DECLARED',
      ledger_baseline_at=excluded.ledger_baseline_at,ledger_history_verified_through=excluded.ledger_history_verified_through,
      ledger_history_reference=excluded.ledger_history_reference`, [accountKey, provider, mode]);
    if(mode==="DEMO") {
      await db.query("update public.execution_accounts set provider_account_id='123',demo_baseline='{\"fixture\":true}' where account_key=$1",[accountKey]);
      await db.query("update public.execution_orders set current_state='CANCELLED' where provider='okx-demo' and client_order_id like 'guard-%' and current_state in('SUBMITTING','SUBMITTED','ACKNOWLEDGED','PARTIALLY_FILLED','RECONCILIATION_REQUIRED')");
    }
    const account = (await db.query("select id,revision from public.execution_accounts where account_key=$1", [accountKey])).rows[0];
    const control = (await db.query("select revision from public.execution_controls where control_key='global'")).rows[0];
    // Preserve PostgreSQL microseconds and make every new fixture newer than
    // prior UNKNOWN observations in the same declared account.
    const cutoff = (await db.query("select clock_timestamp()::text value")).rows[0].value;
    const ids = { intent: randomUUID(), safety: randomUUID(), order: randomUUID(), risk: randomUUID(), observation: randomUUID() };
    const snapshotKey = `guard-${ids.risk}`;
    const economicCutoff = options.economicCutoff ?? cutoff;
    const ledgerVersion = options.ledgerVersion ?? "account-ledger-v2";
    const captureId = mode === "DEMO" ? randomUUID() : null;
    if(captureId) await db.query("insert into public.demo_account_captures(id,account_id,evidence_hash,record) values($1,$2,$3,'{}')",[captureId,account.id,randomUUID()]);
    const ledgerPayload = { ...(mode === "DEMO" ? {demoReconciliation:{externalAccountId:"123",feeRate:0.001}} : {}), version: ledgerVersion, accountId: account.id, status: "KNOWN", unknownReasons: [],
      cutoffAt: cutoff, economicCutoffAt: economicCutoff, cashSek: 1000, realizedPnlSek: 0, dailyRealizedPnlSek: 0,
      feesSek: 0, reservedBuySek: 100, grossExposureSek: 0, availableCashSek: 900, openPositions: 0,
      positions: [], pendingOrders: [], snapshotKey, resultHash: "fixture", ...options.payloadOverrides };
    await db.query(`insert into public.risk_ledger_snapshots(id,snapshot_key,account_id,ledger_version,status,cash_sek,open_positions,
      open_quantity,average_cost_sek,realized_pnl_sek,fees_sek,reserved_exposure_sek,daily_realized_pnl_sek,gross_exposure_sek,
      available_cash_sek,economic_cutoff_at,ledger_payload,evidence_refs,information_cutoff_at,available_at,result_hash,demo_capture_id)
      values($1,$2,$3,$4,'KNOWN',1000,0,null,null,0,0,100,0,0,900,$5,$6::jsonb,'[]',$7,$7,'fixture',$8)`,
      [ids.risk, snapshotKey, account.id, ledgerVersion, economicCutoff, JSON.stringify(ledgerPayload), cutoff,captureId]);
    await db.query(`insert into public.account_state_observations(id,observation_key,account_id,provider,provider_environment,balances,positions,data_status,observed_at,available_at,payload_hash)
      values($1,$2,$3,$4,$5,'[]','[]',$6,$7,$7,'fixture')`, [ids.observation, `guard-${ids.observation}`, account.id, provider, mode, mode === "SHADOW" ? "UNKNOWN" : "KNOWN", cutoff]);
    await db.query(`insert into public.execution_intents(id,intent_key,contract_version,source_type,source_id,asset_id,instrument_id,side,order_type,quote_amount_sek,quantity,limit_price,stop_price,target_price,max_slippage_bps,information_cutoff_at,available_at,expires_at,evidence_refs,payload_hash)
      values($1,$2,'execution-contract-v1',$5,$6,$3,$7,$8,'LIMIT',$9,1,100,90,110,25,$4,$4,clock_timestamp()+interval '1 minute','[]','fixture')`, [ids.intent, `guard-${ids.intent}`, asset, cutoff, options.sourceType??"fixture",options.sourceId??"fixture",options.instrument??"BTC-USDT",options.side??"BUY",options.notional??100]);
    await db.query(`insert into public.execution_safety_evaluations(id,evaluation_key,intent_id,policy_version,decision,requirements,context,limits,result_hash,information_cutoff_at,available_at)
      values($1,$2,$3,'execution-safety-policy-v2','PASSED','[{"status":"PASS"}]','{}','{}','fixture',$4,$4)`, [ids.safety, `guard-${ids.safety}`, ids.intent, cutoff]);
    await db.query(`insert into public.execution_orders(id,intent_id,safety_evaluation_id,provider,provider_environment,client_order_id,current_state,account_id,reservation_fee_buffer_sek)
      values($1,$2,$3,$4,$5,$6,'SAFETY_PASSED',$7,0)`, [ids.order, ids.intent, ids.safety, provider, mode, `guard-${ids.order}`, account.id]);
    const check = { decision: "PASSED", guardVersion: "execution-submission-guard-v1", policyVersion: "execution-safety-policy-v2", requirements: [{ code: "FIXTURE", status: "PASS" }], checkedAt: new Date().toISOString(), dataAgeMs: 1000 };
    const args = [ids.order, provider, mode, control.revision, account.id, account.revision, ids.risk, ids.observation, ids.safety, JSON.stringify(check)];
    return { ...ids, account: account.id, args, check };
  }
  const authorize = async f => (await db.query("select public.authorize_execution_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result", f.args)).rows[0].result;
  const state = async f => (await db.query("select current_state from public.execution_orders where id=$1", [f.order])).rows[0].current_state;
  const sibling = async f => {
    const ids = { intent: randomUUID(), safety: randomUUID(), order: randomUUID() };
    for(const [table,original,patch] of [
      ["execution_intents",f.intent,{id:ids.intent,intent_key:`guard-${ids.intent}`}],
      ["execution_safety_evaluations",f.safety,{id:ids.safety,evaluation_key:`guard-${ids.safety}`,intent_id:ids.intent}],
      ["execution_orders",f.order,{id:ids.order,intent_id:ids.intent,safety_evaluation_id:ids.safety,client_order_id:`guard-${ids.order}`,current_state:"SAFETY_PASSED",provider_order_id:null}],
    ]) await db.query(`insert into public.${table} select (jsonb_populate_record(null::public.${table},to_jsonb(t)||$2::jsonb)).* from public.${table} t where id=$1`,[original,JSON.stringify(patch)]);
    const args=[...f.args];args[0]=ids.order;args[8]=ids.safety;
    return {...f,...ids,args};
  };

  for (const mode of ["SHADOW", "DEMO"]) {
    const f = await fixture(mode);
    assert.equal((await authorize(f)).authorized, true, `${mode} complete approval may claim once`);
    assert.equal(await state(f), "SUBMITTING");
    assert.equal((await authorize(f)).reason, "FINAL_ORDER_NOT_READY");
    assert.equal((await db.query("select count(*)::int count from public.execution_order_events where order_id=$1", [f.order])).rows[0].count, 1);
    assert.equal((await db.query("select public.deny_execution_submission($1,'FINAL_CONTROL_UNKNOWN') result", [f.order])).rows[0].result.blocked, false, "a concurrent denial cannot overwrite a successful claim");
  }
  const race = await fixture("DEMO"), competing = await sibling(race);
  const sql = "select public.authorize_execution_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) result";
  const raceResults = db.parallel ? await db.parallel(sql,[race.args,competing.args]) : await Promise.all([db.query(sql,race.args),db.query(sql,competing.args)]);
  assert.equal(raceResults.filter(row=>row.rows[0].result.authorized===true).length,1,"distinct demo orders cannot consume the same account capture concurrently");
  const winner = raceResults[0].rows[0].result.authorized ? race : competing;
  await db.query("update public.execution_orders set current_state='CANCELLED' where id=$1",[winner.order]);
  const staleReuse = await sibling(winner);
  assert.equal((await authorize(staleReuse)).reason,"FINAL_DEMO_CAPTURE_ALREADY_SPENT","a terminal order does not make old cash evidence spendable again");
  console.log(`Demo claim: one distinct order per capture, terminal-order replay blocked${db.parallel ? "; verified with independent PostgreSQL connections" : ""}.`);
  const killed = await fixture();
  await db.exec("update public.execution_controls set kill_switch=true where control_key='global'");
  assert.equal((await authorize(killed)).reason, "FINAL_KILL_SWITCH_ACTIVE");
  assert.equal(await state(killed), "BLOCKED");

  const disabled = await fixture();
  await db.exec("update public.execution_controls set new_orders_enabled=false where control_key='global'");
  assert.equal((await authorize(disabled)).reason, "FINAL_NEW_ORDERS_DISABLED");

  const revised = await fixture();
  await db.exec("update public.execution_controls set kill_switch=true where control_key='global'; update public.execution_controls set kill_switch=false where control_key='global'");
  assert.equal((await authorize(revised)).reason, "FINAL_CONTROL_REVISION_CHANGED", "an off/on toggle cannot restore an obsolete approval");

  const accountChanged = await fixture();
  await db.query("update public.execution_accounts set status='PAUSED' where id=$1", [accountChanged.account]);
  await db.query("update public.execution_accounts set status='ACTIVE' where id=$1", [accountChanged.account]);
  assert.equal((await authorize(accountChanged)).reason, "FINAL_ACCOUNT_REVISION_CHANGED");

  const paused = await fixture();
  await db.query("update public.execution_accounts set status='PAUSED' where id=$1", [paused.account]);
  assert.equal((await authorize(paused)).reason, "FINAL_ACCOUNT_PAUSED");

  const mismatchedOrder = await fixture();
  await db.query("update public.execution_orders set account_id=$1 where id=$2", [undeclared, mismatchedOrder.order]);
  assert.equal((await authorize(mismatchedOrder)).reason, "FINAL_ACCOUNT_MISMATCH", "an account approval cannot authorize another account's order");
  const unlinkedOrder = await fixture();
  await db.query("update public.execution_orders set account_id=null where id=$1", [unlinkedOrder.order]);
  assert.equal((await authorize(unlinkedOrder)).reason, "FINAL_ACCOUNT_MISMATCH", "legacy unlinked orders remain blocked");

  const legacyRisk = await fixture("SHADOW", { ledgerVersion: "risk-ledger-v1" });
  assert.equal((await authorize(legacyRisk)).reason, "FINAL_RISK_LEDGER_CONTRACT_INVALID", "newer legacy snapshots cannot fall back to older v2 KNOWN records");
  assert.equal((await db.query("select ledger_version from public.risk_ledger_snapshots where id=$1", [legacyRisk.risk])).rows[0].ledger_version, "risk-ledger-v1", "legacy history is not rewritten");

  for (const payloadOverrides of [
    { version: "risk-ledger-v1" }, { status: "UNKNOWN" }, { accountId: undeclared },
    { unknownReasons: ["MISSING_FUNDING_HISTORY"] }, { unknownReasons: null },
    { snapshotKey: "different-snapshot" }, { resultHash: "different-result" },
  ]) {
    const malformed = await fixture("SHADOW", { payloadOverrides });
    assert.equal((await authorize(malformed)).reason, "FINAL_RISK_LEDGER_CONTRACT_INVALID", "row KNOWN does not override an invalid typed ledger payload");
  }

  const economicStale = await fixture("SHADOW", { economicCutoff: new Date(Date.now()-60_000).toISOString() });
  assert.equal((await authorize(economicStale)).reason, "FINAL_DATA_STALE_OR_UNKNOWN", "fresh publication cannot launder stale economic data");
  const economicMismatch = await fixture("SHADOW", { payloadOverrides: { economicCutoffAt: new Date(Date.now()-60_000).toISOString() } });
  assert.equal((await authorize(economicMismatch)).reason, "FINAL_DATA_STALE_OR_UNKNOWN", "payload economic boundary must match persisted boundary");

  const unknownRisk = await fixture();
  await db.query(`insert into public.risk_ledger_snapshots(snapshot_key,account_id,ledger_version,status,information_cutoff_at,available_at,result_hash)
    values($1,$2,'account-ledger-v2','UNKNOWN',clock_timestamp(),clock_timestamp(),'fixture')`, [`guard-${randomUUID()}`, unknownRisk.account]);
  assert.equal((await authorize(unknownRisk)).reason, "FINAL_RISK_REVISION_CHANGED_OR_UNKNOWN");

  const unknownObservation = await fixture("DEMO");
  await db.query(`insert into public.account_state_observations(observation_key,account_id,provider,provider_environment,balances,positions,data_status,observed_at,available_at,payload_hash)
    values($1,$2,'okx-demo','DEMO','[]','[]','UNKNOWN',clock_timestamp(),clock_timestamp(),'fixture')`, [`guard-${randomUUID()}`, unknownObservation.account]);
  assert.equal((await authorize(unknownObservation)).reason, "FINAL_ACCOUNT_OBSERVATION_CHANGED_OR_UNKNOWN");

  const invalid = await fixture();
  invalid.args[9] = JSON.stringify({ ...invalid.check, requirements: [{ status: "UNKNOWN" }] });
  assert.equal((await authorize(invalid)).reason, "FINAL_CHECK_UNKNOWN");

  const stale = await fixture();
  stale.args[9] = JSON.stringify({ ...stale.check, dataAgeMs: 20_000 });
  assert.equal((await authorize(stale)).reason, "FINAL_DATA_STALE_OR_UNKNOWN");

  const existing = await fixture();
  await db.query("update public.execution_orders set provider_order_id='already-submitted' where id=$1", [existing.order]);
  assert.equal((await authorize(existing)).reason, "FINAL_PROVIDER_ORDER_ALREADY_EXISTS");
  assert.equal(await state(existing), "RECONCILIATION_REQUIRED");

  const feeBuffer = await fixture();
  await assert.rejects(db.query("update public.execution_orders set reservation_fee_buffer_sek=-1 where id=$1", [feeBuffer.order]), error => error.code === "23514");
  await assert.rejects(db.query("update public.execution_orders set reservation_fee_buffer_sek='NaN'::numeric where id=$1", [feeBuffer.order]), error => error.code === "23514");
  await db.query("update public.execution_orders set reservation_fee_buffer_sek=null where id=$1", [feeBuffer.order]);
  assert.equal((await db.query("select open_quantity,average_cost_sek from public.risk_ledger_snapshots where id=$1", [feeBuffer.risk])).rows[0].open_quantity, null, "v2 does not require a meaningless cross-instrument quantity scalar");

  await checkDemoTrialGuard(db,{fixture,authorize,asset});
  console.log("Final execution RPC: private roles, single claim, kill/new-orders, revisions, account linkage, v2 payload/identity/UNKNOWN guards, economic freshness, nullable legacy scalars and fee-buffer constraints passed.");
  } finally {
    await db.exec("reset role");
  }
}
