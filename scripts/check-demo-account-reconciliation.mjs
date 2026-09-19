/** Disposable database only; all fixture changes are rolled back. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkDemoAccountReconciliation(db) {
  const prepareSignature = "public.prepare_demo_account_baseline(text,jsonb,jsonb)";
  const publishSignature = "public.publish_demo_account_capture(uuid,bigint,jsonb,jsonb,jsonb)";
  for (const role of ["anon", "authenticated"]) for (const signature of [prepareSignature, publishSignature]) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed, false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role','public.authorize_execution_submission_v2(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed, false, "old entry point cannot bypass demo checks");
  await db.exec("reset role; begin");
  try {
    // Isolate the fixed provider-primary key without changing its original data.
    await db.query("update public.execution_accounts set account_key=$1 where account_key='okx-demo-primary'", [`preserved-${randomUUID()}`]);
    const controlsBefore = (await db.query("select mode,kill_switch,new_orders_enabled,live_execution_enabled from public.execution_controls where control_key='global'")).rows[0];
    const at = new Date(Date.now()-5000).toISOString(), observedAt = new Date(Date.now()-1000).toISOString();
    const evidence = { version: "demo-account-evidence-v1", complete: true, externalAccountId: "123", instrumentId: "BTC-USD", baseCurrency: "BTC", quoteCurrency: "USD",
      startedAt: at, observedAt, windowStart: at, balances: [{ currency: "USD", total: 1000, available: 1000 }], orders: [], bills: [], feeRate: 0.001, mark: { price: 50000, observedAt } };
    const baseline = { version: "demo-account-baseline-v1", externalAccountId: "123", instrumentId: "BTC-USD", baseCurrency: "BTC", quoteCurrency: "USD", cash: 1000, at, evidenceHash: "a".repeat(64) };
    const prepare = async value => (await db.query("select public.prepare_demo_account_baseline('okx-demo',$1::jsonb,$2::jsonb) result", [JSON.stringify(value),JSON.stringify(evidence)])).rows[0].result;
    const mustReject = async (fn, pattern) => {
      await db.exec("savepoint expected_error");
      try { await assert.rejects(fn, pattern); } finally { await db.exec("rollback to savepoint expected_error; release savepoint expected_error"); }
    };
    await db.exec("set local role service_role");
    await mustReject(() => prepare({ ...baseline, cash: 2000 }), /BASELINE_BALANCES_INVALID/);
    // Exercise an existing six-currency account in an isolated savepoint.
    await db.exec("savepoint multiasset_baseline");
    const cashOnly = structuredClone(evidence.balances);
    evidence.balances.push(...["BTC", "XRP", "EUR", "USDC", "ETH"].map(currency => ({ currency, total: 1, available: 1 })));
    const multi = { ...baseline, openingBalances: structuredClone(evidence.balances), openingMarks: [], openingMark: evidence.mark,
      valuationPolicy: "OBSERVED_BASELINE_NOT_HISTORICAL_COST" };
    await mustReject(() => prepare({ ...multi, valuationPolicy: "HISTORICAL_COST" }), /BASELINE_HOLDINGS_INVALID/);
    await mustReject(() => prepare({ ...multi, openingBalances: cashOnly }), /BASELINE_HOLDINGS_INVALID/);
    assert.equal((await prepare(multi)).prepared, true);
    await db.exec("rollback to savepoint multiasset_baseline; release savepoint multiasset_baseline");
    evidence.balances = cashOnly;
    const prepared = await prepare(baseline);
    assert.equal(prepared.tradingControlsChanged, false); assert.equal(prepared.ordersSent, 0);
    const account = (await db.query("select * from public.execution_accounts where id=$1", [prepared.accountId])).rows[0];
    assert.equal(account.status, "PAUSED"); assert.equal(account.provider_account_id, "123");
    assert.equal((await prepare(baseline)).reused, true);
    await mustReject(() => prepare({ ...baseline, evidenceHash: "b".repeat(64) }), /ALREADY_BOUND/);
    await mustReject(() => prepare({ ...baseline, cash: 999 }), /BASELINE_BALANCES_INVALID/);
    assert.deepEqual((await db.query("select mode,kill_switch,new_orders_enabled,live_execution_enabled from public.execution_controls where control_key='global'")).rows[0], controlsBefore);
    const snapshot = status => {
      const hash = randomUUID().replaceAll("-", "").repeat(2), cutoff = new Date(Date.now()-500).toISOString();
      return { version: "account-ledger-v2", snapshotKey: `account_v2_${hash.slice(0,40)}`, resultHash: hash, accountId: account.id, baselineAt: at,
        status, cutoffAt: cutoff, economicCutoffAt: cutoff, cashSek: status === "KNOWN" ? 10000 : null, openPositions: status === "KNOWN" ? 0 : null,
        realizedPnlSek: 0, dailyRealizedPnlSek: 0, feesSek: 0, reservedBuySek: 0, grossExposureSek: 0, availableCashSek: status === "KNOWN" ? 10000 : null,
        unknownReasons: status === "KNOWN" ? [] : ["DEMO_CAPTURE_FAILED"],
        demoReconciliation: { externalAccountId: "123", instrumentId: "BTC-USD", quoteSekRate: 10, feeRate: 0.001 } };
    };
    const publish = (snap, record = { evidence, errorReason: null }, revision = account.revision) => db.query(
      "select public.publish_demo_account_capture($1,$2,$3::jsonb,$4::jsonb,'[]') result",
      [account.id,revision,JSON.stringify(record),JSON.stringify(snap)]);
    const known = snapshot("KNOWN");
    await mustReject(() => publish(known, undefined, Number(account.revision)+1), /REVISION_CHANGED/);
    await mustReject(() => publish(known, undefined, null), /REVISION_CHANGED/);
    await mustReject(() => publish(known, { evidence: { ...evidence, externalAccountId: "999" }, errorReason: null }), /NOT_RECONCILED/);
    const published = (await publish(known)).rows[0].result;
    assert.equal(published.status, "KNOWN");
    assert.equal((await db.query("select count(*)::int n from public.risk_ledger_snapshots where account_id=$1",[account.id])).rows[0].n,1);
    await publish(known);
    assert.equal((await db.query("select count(*)::int n from public.risk_ledger_snapshots where account_id=$1",[account.id])).rows[0].n,1,"idempotent capture publication");
    await db.exec("reset role");
    await db.exec(`create function public.demo_fixture_reject_risk() returns trigger language plpgsql as $$ begin raise exception 'DEMO_TEST_ATOMIC_FAILURE'; end; $$;
      create trigger demo_fixture_reject_risk before insert on public.risk_ledger_snapshots for each row execute function public.demo_fixture_reject_risk();`);
    const counts = async () => (await db.query("select (select count(*) from public.demo_account_captures where account_id=$1)::int captures,(select count(*) from public.account_state_observations where account_id=$1)::int observations",[account.id])).rows[0];
    const before = await counts();
    await db.exec("set local role service_role");
    await mustReject(() => publish(snapshot("KNOWN")), /DEMO_TEST_ATOMIC_FAILURE/);
    assert.deepEqual(await counts(), before,"failed risk write rolls back evidence AND observation");
    await db.exec("reset role; drop trigger demo_fixture_reject_risk on public.risk_ledger_snapshots; drop function public.demo_fixture_reject_risk(); set local role service_role");
    await publish(snapshot("UNKNOWN"), { evidence: null, errorReason: "DEMO_CAPTURE_FAILED" });
    assert.equal((await db.query("select status from public.risk_ledger_snapshots where account_id=$1 order by information_cutoff_at desc,id desc limit 1",[account.id])).rows[0].status,"UNKNOWN");
    console.log("Demo account SQL: private access, immutable binding, paused baseline, idempotent atomic publication, revision/identity guards and UNKNOWN failure publication passed.");
  } finally { await db.exec("reset role; rollback"); }
}
