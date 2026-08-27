import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const suite =
  process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
let db: SupabaseClient;

suite("Supabase strategy validation and runtime governance v1", () => {
  beforeAll(() => {
    db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it("exposes the active validation protocol and all runtime stores", async () => {
    const [protocol, hypotheses, validations, runtime, capital] =
      await Promise.all([
        db
          .from("strategy_validation_protocols")
          .select("id,protocol_key,version,status,definition")
          .eq("status", "ACTIVE")
          .single(),
        db.from("strategy_hypotheses").select("id").limit(1),
        db.from("strategy_validation_runs").select("id").limit(1),
        db.from("strategy_runtime_assessments").select("id").limit(1),
        db.from("strategy_capital_gate_decisions").select("id").limit(1),
      ]);
    expect(protocol.error).toBeNull();
    expect(protocol.data).toMatchObject({
      protocol_key: "strategy-validation-protocol",
      version: 1,
      status: "ACTIVE",
    });
    expect(protocol.data?.definition.minimumTrades).toBe(30);
    for (const result of [hypotheses, validations, runtime, capital])
      expect(result.error).toBeNull();
  });

  it("keeps protocol history immutable", async () => {
    const { data } = await db
      .from("strategy_validation_protocols")
      .select("id")
      .eq("protocol_key", "strategy-validation-protocol")
      .eq("version", 1)
      .single();
    const result = await db
      .from("strategy_validation_protocols")
      .update({ status: "DEPRECATED" })
      .eq("id", data!.id);
    expect(result.error?.message).toContain("immutable");
  });

  it("exposes automated window and shadow tracking stores and scheduler jobs", async () => {
    const [
      plans,
      observations,
      attributions,
      signalEvaluations,
      signals,
      shadowTrades,
      promotions,
      lifecycle,
      researchCycles,
      triageRuns,
      jobs,
    ] = await Promise.all([
      db.from("strategy_validation_window_plans").select("id").limit(1),
      db.from("strategy_shadow_observations").select("id").limit(1),
      db
        .from("strategy_attribution_contexts")
        .select(
          "id,status,strategy_definition_id,strategy_version,validation_run_id",
        )
        .limit(1),
      db
        .from("strategy_signal_evaluations")
        .select("id,decision,signal_id")
        .limit(1),
      db.from("strategy_runtime_signals").select("id,signal_key,side").limit(1),
      db
        .from("strategy_shadow_trade_revisions")
        .select("id,signal_id,revision_number,state")
        .limit(1),
      db.from("strategy_promotion_evaluations").select("id,decision,blockers").limit(1),
      db.from("strategy_lifecycle_revisions").select("id,state,revision_number").limit(1),
      db.from("strategy_research_cycle_runs").select("id,status,progress,result_hash").limit(1),
      db.from("strategy_candidate_triage_runs").select("id,recommendation,metrics,result_hash").limit(1),
      db
        .from("scheduled_jobs")
        .select("job_key,job_type,enabled")
        .in("job_key", [
          "strategy-validation-windows-1h",
          "strategy-shadow-tracking-5m",
          "strategy-signal-producer-1m",
          "strategy-shadow-execution-1m",
          "strategy-validation-promotion-15m",
          "strategy-research-cycle-15m",
          "strategy-candidate-triage-1h",
        ]),
    ]);

    expect(plans.error).toBeNull();
    expect(observations.error).toBeNull();
    expect(attributions.error).toBeNull();
    expect(signalEvaluations.error).toBeNull();
    expect(signals.error).toBeNull();
    expect(shadowTrades.error).toBeNull();
    expect(promotions.error).toBeNull();
    expect(lifecycle.error).toBeNull();
    expect(researchCycles.error).toBeNull();
    expect(triageRuns.error).toBeNull();
    expect(jobs.error).toBeNull();
    expect(jobs.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job_key: "strategy-validation-windows-1h",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-shadow-tracking-5m",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-signal-producer-1m",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-shadow-execution-1m",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-validation-promotion-15m",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-research-cycle-15m",
          enabled: true,
        }),
        expect.objectContaining({
          job_key: "strategy-candidate-triage-1h",
          enabled: false,
        }),
      ]),
    );
  });

  it("keeps research-cycle history immutable", async () => {
    const row = await db
      .from("strategy_research_cycle_runs")
      .select("id")
      .limit(1)
      .maybeSingle();
    expect(row.error).toBeNull();
    expect(row.data).not.toBeNull();
    const mutation = await db
      .from("strategy_research_cycle_runs")
      .update({ status: "READY_FOR_VALIDATION" })
      .eq("id", row.data!.id);
    expect(mutation.error?.message).toContain("immutable");
  });
});
