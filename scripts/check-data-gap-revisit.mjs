/** Called by the memory-only migration harness. Never opens a remote database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runDataGapRevisitChecks(db) {
  // Prior disposable runs leave future-dated fixtures that become eligible as
  // wall time advances. Retire only this harness's explicitly tagged records.
  await db.query("update public.jackpot_candidates set current_state='EXPIRED' where collector_version='fixture' and created_from_event_id like 'gap-fixture-%' and current_state not in('EXPIRED','REJECTED')");
  // A fixture-only clock ahead of wall time permits deterministic PIT checks
  // without sleeps. Nothing here uses application env or production credentials.
  const epoch = Date.now() + 60_000;
  const at = minutes => new Date(epoch + minutes * 60_000).toISOString();
  const asset = randomUUID();
  const event = `gap-fixture-${randomUUID()}`;
  await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Memory-only gap fixture')", [asset, event]);
  await db.query(`insert into public.event_outbox(event_id,event_type,schema_version,entity_type,entity_id,asset_id,
    occurred_at,observed_at,available_at,provider,source_reference,data_quality,payload_hash)
    values($1,'market.pool_created',1,'asset',$2::text,$2::uuid,$3,$3,$3,'fixture','memory-only',0,$4)`, [event, asset, at(-30), "b".repeat(64)]);
  const seed = async (detectedMinutes, state = "INSUFFICIENT_DATA", expiry = at(1440)) => {
    const id = randomUUID();
    await db.query(`insert into public.jackpot_candidates(id,candidate_key,asset_id,strategy,active_window_start,detected_at,
      current_state,current_revision,collector_version,created_from_event_id,expires_at)
      values($1::uuid,$1::text,$2,'fixture',$3,$3,$4,1,'fixture',$5,$6)`, [id, asset, at(detectedMinutes), state, event, expiry]);
    await db.query(`insert into public.jackpot_candidate_revisions(candidate_id,revision_number,revision_type,state,
      information_cutoff_at,available_at,features,revision_hash)
      values($1::uuid,1,'v0_detection',$2,$3,$3,'{"riskStatus":"UNKNOWN"}',$1::text)`, [id, state, at(detectedMinutes)]);
    return id;
  };
  const claim = async (time, limit = 1) => (await db.query("select * from public.claim_candidate_data_gaps($1,$2)", [limit, time])).rows;
  const release = async (entry, retry = at(60)) => db.query("select public.release_candidate_data_gap($1,$2,$3,$4) released",
    [entry.candidate_id, entry.claim_token, retry, '["FIXTURE_FAILURE"]']);
  const closure = (hash, options = {}) => ({
    features: { riskStatus: "UNKNOWN", liquidity: null }, evidence: [],
    gaps: { safety: "UNKNOWN", liquidity: "UNKNOWN", wallet_independence: "UNKNOWN" },
    errors: [], closureHash: hash, version: "candidate-data-gap-closure-v3", ...options,
  });
  const finish = async (entry, revision, time, value, retry, pending = null) => (await db.query(
    "select * from public.finish_candidate_data_gap($1,$2,$3,$4,$5::jsonb,$6,$7)",
    [entry.candidate_id, entry.claim_token, revision, time, JSON.stringify(value), retry, pending],
  )).rows[0];
  const revisions = async id => (await db.query("select * from public.jackpot_candidate_revisions where candidate_id=$1 order by revision_number", [id])).rows;

  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_table_privilege($1,'public.candidate_data_gap_work','select') allowed", [role])).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege($1,'public.claim_candidate_data_gaps(integer,timestamptz)','execute') allowed", [role])).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege($1,'public.finish_candidate_data_gap(uuid,uuid,integer,timestamptz,jsonb,timestamptz,timestamptz)','execute') allowed", [role])).rows[0].allowed, false);
  }
  await db.exec("set role service_role");
  const old = await seed(-20);
  const newer = await seed(-10);
  const first = (await claim(at(0)))[0];
  const second = (await claim(at(0)))[0];
  assert.equal(first.candidate_id, old, "oldest unvisited candidate receives service first");
  assert.equal(second.candidate_id, newer, "an active lease cannot be double claimed");
  assert.equal((await claim(at(0))).length, 0);
  const originalRevision = (await revisions(old))[0];
  const firstResult = await finish(first, 1, at(0), closure(`waiting-${old}`), at(5), at(0.2));
  assert.deepEqual(firstResult, { created: true, result_revision: 2, work_status: "WAITING_EVIDENCE" });
  await release(second, at(20));
  assert.equal((await claim(at(0))).length, 0, "post-cutoff evidence waits for a later cutoff");
  const revisit = (await claim(at(5)))[0];
  assert.equal(revisit.candidate_id, old, "due evidence revisit is not discarded by newest-only selection");
  const laterEvidence = closure(`risk-${old}`, {
    evidence: [{ id: "persisted-risk", type: "token_risk_assessment", source: "fixture", availableAt: at(0.2), dataQuality: 50 }],
  });
  assert.equal((await finish(revisit, 2, at(5), laterEvidence, at(10))).work_status, "PARTIAL");
  const history = await revisions(old);
  assert.deepEqual(history[0], originalRevision, "earlier evidence is immutable");
  assert.equal(history[1].evidence_refs.length, 0, "later evidence is not backdated into first revision");
  assert.equal(history[2].evidence_refs[0].id, "persisted-risk");
  assert.equal(history[2].safety_result.status, "UNKNOWN", "more observations do not manufacture known safety");
  const repeated = (await claim(at(10)))[0];
  assert.deepEqual(await finish(repeated, 3, at(10), laterEvidence, at(15)), { created: false, result_revision: 3, work_status: "PARTIAL" });
  assert.equal((await revisions(old)).length, 3, "unchanged evidence never creates a duplicate immutable revision");

  const completeEvidence = closure(`complete-${old}`, { features: { riskStatus: "LOW_RISK" }, gaps: { safety: "CLOSED", liquidity: "CLOSED" } });
  const completion = (await claim(at(15)))[0];
  assert.equal((await finish(completion, 3, at(15), completeEvidence, at(20))).work_status, "COMPLETE");
  // An external collector can append a new source revision after a completed pass.
  await db.query(`insert into public.jackpot_candidate_revisions(candidate_id,revision_number,revision_type,state,
    information_cutoff_at,available_at,features,revision_hash)
    values($1,5,'v2_wallet_enrichment','INSUFFICIENT_DATA',$2,$2,'{"riskStatus":"LOW_RISK"}',$3)`, [old, at(15), `external-${old}`]);
  await db.query("update public.jackpot_candidates set current_revision=5 where id=$1", [old]);
  const afterExternal = (await claim(at(21)))[0];
  assert.equal(afterExternal.candidate_id, old);
  assert.deepEqual(await finish(afterExternal, 5, at(21), completeEvidence, at(26)), { created: false, result_revision: 5, work_status: "COMPLETE" });
  const newDue = (await claim(at(30)))[0];
  assert.equal(newDue.candidate_id, newer, "dedup records the processed current revision and does not loop COMPLETE forever");
  await release(newDue, at(90));

  const guarded = await seed(-5);
  const guardedClaim = (await claim(at(30)))[0];
  assert.equal(guardedClaim.candidate_id, guarded);
  await assert.rejects(finish(guardedClaim, 1, at(30), closure(`future-${guarded}`, {
    evidence: [{ availableAt: at(31) }],
  }), at(35)), /FUTURE_EVIDENCE_REJECTED/);
  assert.equal((await revisions(guarded)).length, 1);
  assert.equal((await finish({ ...guardedClaim, claim_token: randomUUID() }, 1, at(30), closure("wrong-claim"), at(35))).work_status, "LEASE_LOST");
  assert.equal((await finish(guardedClaim, 999, at(30), closure("wrong-revision"), at(35))).work_status, "REVISION_CHANGED");
  const retry = (await claim(at(30)))[0];
  // Force the final evaluation insert to fail AFTER the revision write. The
  // transaction must roll back revision, candidate pointer and queue progress.
  await assert.rejects(finish(retry, 1, at(30), closure(`atomic-${guarded}`, { version: null }), at(35)));
  assert.equal((await revisions(guarded)).length, 1);
  assert.equal((await db.query("select current_revision from public.jackpot_candidates where id=$1", [guarded])).rows[0].current_revision, 1);
  assert.equal((await finish(retry, 1, at(30), closure(`atomic-${guarded}`), at(90))).created, true);

  const expiredDuringFetch = await seed(-2);
  const expiringClaim = (await claim(at(30)))[0];
  assert.equal(expiringClaim.candidate_id, expiredDuringFetch);
  await db.query("update public.jackpot_candidates set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expiredDuringFetch]);
  assert.equal((await finish(expiringClaim, 1, at(30), closure(`expired-${expiredDuringFetch}`), at(35))).work_status, "CANCELLED");
  assert.equal((await revisions(expiredDuringFetch)).length, 1);
  const rejectedDuringFetch = await seed(-1);
  const rejectingClaim = (await claim(at(30)))[0];
  await db.query("update public.jackpot_candidates set current_state='REJECTED' where id=$1", [rejectedDuringFetch]);
  assert.equal((await finish(rejectingClaim, 1, at(30), closure(`rejected-${rejectedDuringFetch}`), at(35))).work_status, "CANCELLED");
  assert.equal((await revisions(rejectedDuringFetch)).length, 1);
  await seed(-10, "EXPIRED");
  await seed(-10, "REJECTED");
  await seed(-10, "DISCOVERED", at(-1));
  await seed(100);
  for (let index = 0; index < 25; index++) await seed(-1);
  const capped = await claim(at(30), 999);
  assert.equal(capped.length, 20, "database enforces the batch cap, independently of caller");
  assert.equal((await claim(at(30), 999)).length, 5, "leased, future, terminal and expired candidates are filtered before limiting");
  await db.exec("reset role");
  console.log("Passed: gap revisit fairness, claim leases/cap, fixed-cutoff deferral, immutable evidence, UNKNOWN safety, dedup, rollback, source conflict, expiry/terminal cancellation and role isolation.");
}
