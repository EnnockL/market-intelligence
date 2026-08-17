import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("Supabase decision infrastructure", () => {
  let db: SupabaseClient;
  let assetId: string;
  const run = crypto.randomUUID();
  const eventId = `integration-${run}`;
  const consumer = `integration-${run}`;
  const firstWorker = `crashed-${run}`;
  const recoveryWorker = `recovery-${run}`;
  const evidenceId = `integration-evidence-${run}`;
  const futureEvidenceId = `integration-future-${run}`;
  const opportunityId = crypto.randomUUID();

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase integration credentials are missing");
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("assets").select("id").limit(1).single();
    if (error) throw error;
    assetId = data.id;
  });

  it("has migrations 0013 and 0014 operational", async () => {
    const { data: transition, error: transitionError } = await db.rpc("valid_opportunity_transition", {
      p_current: "detected", p_next: "enriching",
    });
    expect(transitionError).toBeNull();
    expect(transition).toBe(true);
    const { error } = await db.from("event_outbox").insert({
      event_id: eventId, schema_version: 1, event_type: `integration.${run}`, entity_type: "integration",
      entity_id: run, asset_id: assetId, occurred_at: "2000-01-01T00:00:00.000Z",
      observed_at: "2000-01-01T00:00:00.000Z", available_at: "2000-01-01T00:00:00.000Z",
      provider: "integration-test", source_reference: run, data_quality: 100, confidence: 100,
      payload: { run }, payload_hash: "a".repeat(64), correlation_id: run,
    });
    expect(error).toBeNull();
  });

  it("recovers a consumer lease after a simulated worker crash", async () => {
    const claim = (worker: string) => db.rpc("claim_outbox_events_for_consumer", {
      p_consumer_name: consumer, p_event_types: [`integration.${run}`], p_worker_id: worker,
      p_limit: 1, p_lock_timeout_seconds: 1,
    });
    const first = await claim(firstWorker);
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({ event_id: eventId, attempts: 1, locked_by: firstWorker });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recovered = await claim(recoveryWorker);
    expect(recovered.error).toBeNull();
    expect(recovered.data).toHaveLength(1);
    expect(recovered.data[0]).toMatchObject({ event_id: eventId, attempts: 2, locked_by: recoveryWorker });
  });

  it("persists failure, retry and completion without duplicate delivery", async () => {
    const failed = await db.rpc("fail_outbox_delivery", { p_consumer_name: consumer, p_event_id: eventId,
      p_worker_id: recoveryWorker, p_error: "intentional integration failure", p_retry_delay_seconds: 1 });
    expect(failed.error).toBeNull();
    expect(failed.data).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const retry = await db.rpc("claim_outbox_events_for_consumer", { p_consumer_name: consumer,
      p_event_types: [`integration.${run}`], p_worker_id: recoveryWorker, p_limit: 1, p_lock_timeout_seconds: 1 });
    expect(retry.error).toBeNull();
    expect(retry.data[0]).toMatchObject({ event_id: eventId, attempts: 3 });
    const complete = await db.rpc("complete_outbox_delivery", { p_consumer_name: consumer,
      p_event_id: eventId, p_worker_id: recoveryWorker });
    expect(complete.error).toBeNull();
    expect(complete.data).toBe(true);
    const duplicate = await db.rpc("claim_outbox_events_for_consumer", { p_consumer_name: consumer,
      p_event_types: [`integration.${run}`], p_worker_id: recoveryWorker, p_limit: 1, p_lock_timeout_seconds: 1 });
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toHaveLength(0);
  });

  it("enforces evidence cutoff and immutable revisions in PostgreSQL", async () => {
    const cutoff = new Date();
    const createdAt = new Date(cutoff.getTime() + 1_000).toISOString();
    const futureAt = new Date(cutoff.getTime() + 60_000).toISOString();
    const { error: evidenceError } = await db.from("evidence_records").insert([
      { evidence_id: evidenceId, evidence_type: "integration", source_table: "integration",
        source_record_id: run, available_at: cutoff.toISOString(), payload_hash: "b".repeat(64), metadata: { run } },
      { evidence_id: futureEvidenceId, evidence_type: "integration", source_table: "integration",
        source_record_id: `${run}-future`, available_at: futureAt, payload_hash: "c".repeat(64), metadata: { run } },
    ]);
    expect(evidenceError).toBeNull();
    const created = await db.rpc("create_opportunity_v1", { p_opportunity_id: opportunityId,
      p_opportunity_key: `integration-${run}`, p_asset_id: assetId, p_opportunity_type: "integration",
      p_detected_at: createdAt, p_created_from_event_id: eventId, p_policy_version: "integration-v1" });
    expect(created.error).toBeNull();
    expect(created.data).toBe(opportunityId);
    const future = await db.rpc("append_opportunity_revision_v1", { p_opportunity_id: opportunityId,
      p_revision_key: `${run}-future`, p_revision_type: "v0_fast_safety", p_next_state: "enriching",
      p_created_at: createdAt, p_information_cutoff_at: cutoff.toISOString(), p_trigger_event_id: eventId,
      p_evidence_ids: [futureEvidenceId], p_agent_outputs: {}, p_safety_result: {},
      p_opportunity_score: 0, p_risk_score: null, p_data_quality: 100 });
    expect(future.error?.message).toMatch(/Evidence unavailable at information cutoff/);
    const appended = await db.rpc("append_opportunity_revision_v1", { p_opportunity_id: opportunityId,
      p_revision_key: `${run}-valid`, p_revision_type: "v0_fast_safety", p_next_state: "enriching",
      p_created_at: createdAt, p_information_cutoff_at: cutoff.toISOString(), p_trigger_event_id: eventId,
      p_evidence_ids: [evidenceId], p_agent_outputs: { integration: true }, p_safety_result: { status: "passed" },
      p_opportunity_score: 70, p_risk_score: 10, p_data_quality: 100 });
    expect(appended.error).toBeNull();
    expect(appended.data).toBe(true);
    const duplicate = await db.rpc("append_opportunity_revision_v1", { p_opportunity_id: opportunityId,
      p_revision_key: `${run}-valid`, p_revision_type: "v0_fast_safety", p_next_state: "enriching",
      p_created_at: createdAt, p_information_cutoff_at: cutoff.toISOString(), p_trigger_event_id: eventId,
      p_evidence_ids: [evidenceId], p_agent_outputs: { integration: true }, p_safety_result: { status: "passed" },
      p_opportunity_score: 70, p_risk_score: 10, p_data_quality: 100 });
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toBe(false);
    const { data: revision, error: readError } = await db.from("opportunity_revisions")
      .select("id,revision_number,evidence_refs").eq("opportunity_id", opportunityId).single();
    expect(readError).toBeNull();
    if (!revision) throw new Error("Persisted opportunity revision was not found");
    expect(revision.revision_number).toBe(1);
    expect(revision.evidence_refs).toHaveLength(1);
    const mutation = await db.from("opportunity_revisions").update({ state: "qualified" }).eq("id", revision.id);
    expect(mutation.error?.message).toMatch(/immutable/i);
  });
});
