import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// vitest.config permits writes only to an explicitly isolated test database.
const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
let db: SupabaseClient;

type SchedulerFixture = { jobId: string; now: string; workerId: string };

async function withSchedulerFixture(run: (fixture: SchedulerFixture) => Promise<void>) {
  const before = await db.from("scheduled_jobs").select("*", { count: "exact" }).order("id");
  expect(before.error).toBeNull();
  expect(before.data).not.toBeNull();
  // A truncated snapshot cannot prove that the fixture is the only due job.
  expect(before.data!.length).toBe(before.count);

  const jobId = randomUUID();
  // Never pause, enable, or rewrite a real seeded job. Use a clock before every
  // existing job's next_run_at, so only this test-owned job can be claimed.
  const earliest = Math.min(Date.now(), ...before.data!.map(job => Date.parse(job.next_run_at)));
  expect(Number.isFinite(earliest)).toBe(true);
  const now = new Date(earliest - 60_000).toISOString();
  const old = new Date(earliest - 3_600_000).toISOString();
  const workerId = `scheduler-fixture:${jobId}`;

  try {
    const prepared = await db.from("scheduled_jobs").insert({
      id: jobId,
      job_key: workerId,
      job_type: "BASELINE_FORECAST",
      scheduler_version: "scheduler-integration-fixture-v1",
      interval_seconds: 300,
      lease_seconds: 60,
      status: "HEALTHY",
      enabled: true,
      next_run_at: old,
      locked_at: old,
      locked_by: `${workerId}:crashed`,
    });
    expect(prepared.error).toBeNull();
    const crashed = await db.from("scheduled_job_runs").insert({
      job_id: jobId,
      scheduled_for: old,
      status: "RUNNING",
      attempt: 1,
      worker_id: `${workerId}:crashed`,
      started_at: old,
      heartbeat_at: old,
    });
    expect(crashed.error).toBeNull();
    await run({ jobId, now, workerId });
  } finally {
    // Delete only the unique fixture. Run every cleanup step even if one fails;
    // never use an unscoped update to "restore" all jobs to HEALTHY/enabled.
    const cleanup = [];
    cleanup.push(...await Promise.allSettled([
      db.from("scheduled_job_runs").delete().eq("job_id", jobId),
    ]));
    cleanup.push(...await Promise.allSettled([
      db.from("scheduled_jobs").delete().eq("id", jobId),
    ]));
    for (const result of cleanup) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") expect(result.value.error).toBeNull();
    }
    const after = await db.from("scheduled_jobs").select("*").order("id");
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  }
}

suite("Supabase forecast scheduler leases", () => {
  beforeAll(() => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("recovers an expired lease and prevents a parallel duplicate claim", async () => {
    await withSchedulerFixture(async ({ jobId, now, workerId }) => {
      const owners = [`${workerId}:a`, `${workerId}:b`];
      const claims = await Promise.all(owners.map(owner => db.rpc("claim_forecast_scheduled_job", {
        p_worker_id: owner, p_now: now,
      })));
      for (const claim of claims) expect(claim.error).toBeNull();
      const claimed = claims.flatMap(claim => claim.data ?? []);
      expect(claimed).toHaveLength(1);
      const run = claimed[0];
      expect(run).toMatchObject({ job_id: jobId, status: "RUNNING", attempt: 2 });
      expect(owners).toContain(run.worker_id);

      const finished = await db.rpc("finish_forecast_scheduled_job", {
        p_run_id: run.id, p_worker_id: run.worker_id, p_success: true,
        p_records: 0, p_metrics: { fixtureId: jobId }, p_error: null, p_now: now,
      });
      expect(finished.error).toBeNull();
      const stored = await db.from("scheduled_job_runs").select("id,worker_id,status,metrics")
        .eq("id", run.id).eq("job_id", jobId).single();
      expect(stored.error).toBeNull();
      expect(stored.data).toMatchObject({
        id: run.id, worker_id: run.worker_id, status: "SUCCEEDED", metrics: { fixtureId: jobId },
      });
    });
  }, 30_000);

  it("stores heartbeat and run metrics for its own claimed run", async () => {
    await withSchedulerFixture(async ({ jobId, now, workerId }) => {
      const claim = await db.rpc("claim_forecast_scheduled_job", { p_worker_id: workerId, p_now: now });
      expect(claim.error).toBeNull();
      expect(claim.data).toHaveLength(1);
      const run = claim.data[0];
      expect(run).toMatchObject({ job_id: jobId, worker_id: workerId });
      const heartbeatAt = new Date(Date.parse(now) + 10_000).toISOString();
      const heartbeat = await db.rpc("heartbeat_forecast_scheduled_job", {
        p_run_id: run.id, p_worker_id: workerId, p_now: heartbeatAt,
      });
      expect(heartbeat.error).toBeNull();
      const running = await db.from("scheduled_job_runs").select("status,heartbeat_at")
        .eq("id", run.id).eq("worker_id", workerId).single();
      expect(running.error).toBeNull();
      expect(running.data?.status).toBe("RUNNING");
      expect(Date.parse(running.data!.heartbeat_at)).toBe(Date.parse(heartbeatAt));

      const finished = await db.rpc("finish_forecast_scheduled_job", {
        p_run_id: run.id, p_worker_id: workerId, p_success: true,
        p_records: 7, p_metrics: { fixtureId: jobId, checked: 7 }, p_error: null, p_now: heartbeatAt,
      });
      expect(finished.error).toBeNull();
      const stored = await db.from("scheduled_job_runs").select("status,metrics,heartbeat_at,records_processed")
        .eq("id", run.id).eq("worker_id", workerId).single();
      expect(stored.error).toBeNull();
      expect(stored.data).toMatchObject({
        status: "SUCCEEDED", records_processed: 7, metrics: { fixtureId: jobId, checked: 7 },
      });
      expect(Date.parse(stored.data!.heartbeat_at)).toBe(Date.parse(heartbeatAt));
    });
  }, 30_000);
});
