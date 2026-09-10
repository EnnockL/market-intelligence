import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Called only by the disposable PostgreSQL harness. No application credentials.
export async function checkWalletEvidenceWindow(db) {
  await db.exec("reset role");
  const asset = randomUUID(), wallet = randomUUID();
  const firstId = randomUUID(), secondId = randomUUID();
  const firstAt = "2026-08-01T12:00:00Z", secondAt = "2026-08-01T13:00:00Z";
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto','WINDOW_RETRY_SQL','Isolated window fixture')", [asset]);
  await db.query("insert into public.wallets(id,address) values($1,$2)", [wallet, `window-retry-${wallet}`]);
  const transaction = (id, time, side = "buy", ingestedAt = "2026-08-02T00:00:00Z") => db.query(`
    insert into public.wallet_transactions(id,wallet_id,asset_id,transaction_hash,side,quantity,occurred_at,ingested_at)
    values($1::uuid,$2,$3,($1::uuid)::text,$4,1,$5,$6)`, [id, wallet, asset, side, time, ingestedAt]);
  await transaction(firstId, firstAt);
  await transaction(secondId, secondAt);
  await transaction(randomUUID(), "2100-01-01T00:00:00Z");
  await transaction(randomUUID(), "2026-07-01T00:00:00Z", "buy", "2100-01-01T00:00:00Z");
  const addLiquidity = (effectiveAt, availableAt, liquidity = 100, targetAsset = asset) => db.query(`
    insert into public.crypto_liquidity_snapshots(snapshot_key,asset_id,liquidity_usd,provider,
      selection_version,observed_at,effective_at,information_available_at,data_quality)
    values($1,$2,$3,'isolated-liquidity','latest-effective-highest-liquidity-v1',$4,$4,$5,90)`,
  [randomUUID(), targetAsset, liquidity, effectiveAt, availableAt]);
  const coverage = async (at = firstAt) => (await db.query(
    "select public.wallet_has_liquidity_evidence_at($1,$2) covered", [asset, at])).rows[0].covered;
  const claim = () => db.query("select * from public.wallet_evidence_missing_window($1)", [asset]);

  for (const role of ["anon", "authenticated"]) {
    for (const signature of ["wallet_has_liquidity_evidence_at(uuid,timestamptz)", "wallet_evidence_missing_window(uuid)"]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, `public.${signature}`])).rows[0].allowed, false);
    }
  }
  await db.exec("set role service_role");
  assert.equal(await coverage(), false);
  await addLiquidity("2026-08-01T12:00:30Z", "2026-08-01T12:00:30Z");
  assert.equal(await coverage(), false, "future-effective evidence does not cover a historical trade");
  await addLiquidity("2026-08-01T11:59:00Z", "2026-08-01T12:00:05Z");
  assert.equal(await coverage(), false, "later-known historical evidence does not cover a historical trade");
  await addLiquidity("2026-08-01T11:57:59Z", "2026-08-01T11:57:59Z");
  assert.equal(await coverage(), false, "out-of-window evidence is not considered covered");
  assert.equal(new Date((await claim()).rows[0].occurred_at).toISOString(), new Date(firstAt).toISOString());
  assert.equal(new Date((await claim()).rows[0].occurred_at).toISOString(), new Date(secondAt).toISOString(), "failed/empty first window does not starve another transaction");
  assert.equal((await claim()).rows.length, 0, "cooldown excludes attempted and future/unavailable transactions");

  // Simulate time advancing only in the scheduling ledger; historical evidence
  // is left untouched. Even zero liquidity is a real observation, not absence.
  await db.query("update public.ingestion_work_attempts set last_attempt_at=now()-interval '6 minutes' where work_key='wallet-evidence-window-v1' and subject_id in ($1,$2)", [firstId, secondId]);
  await addLiquidity("2026-08-01T11:58:00Z", "2026-08-01T12:00:00Z", 0);
  assert.equal(await coverage(), true, "effective and availability cutoff boundaries are inclusive");
  assert.equal(new Date((await claim()).rows[0].occurred_at).toISOString(), new Date(secondAt).toISOString(), "missing evidence takes priority over covered-window risk refresh");
  assert.equal(new Date((await claim()).rows[0].occurred_at).toISOString(), new Date(firstAt).toISOString(), "covered-window fallback remains available for risk refresh");
  assert.equal((await claim()).rows.length, 0);

  await db.query("update public.ingestion_work_attempts set last_attempt_at=now()-interval '6 minutes' where work_key='wallet-evidence-window-v1' and subject_id=$1", [firstId]);
  await db.exec("begin");
  assert.equal((await claim()).rows.length, 1);
  await db.exec("rollback");
  assert.equal((await claim()).rows.length, 1, "window selection and attempt commit together");
  await assert.rejects(db.query("select * from public.wallet_evidence_missing_window(null)"), /WALLET_EVIDENCE_ASSET_REQUIRED/);
  await db.exec("reset role");
  console.log("Passed: shared wallet PIT coverage, future/late-data rejection, cutoff boundaries, retry rotation/cooldown, covered-risk fallback, rollback and private roles.");
}
