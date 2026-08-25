import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MetaAgentService } from "@/services/meta-agent/service";

const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
let db: SupabaseClient;
suite("Supabase meta agent foundation v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("persists immutable, idempotent assessments", async () => {
    const cutoff = "2026-08-24T23:59:59.000Z", service = new MetaAgentService(db);
    const first = await service.run(cutoff), second = await service.run(cutoff);
    expect(first.evaluated).toBeGreaterThanOrEqual(0); expect(second.created).toBe(0);
    const { data, error } = await db.from("meta_assessments").select("decision,ready_for_policy_evaluation,meta_assessment_requirements(status)").eq("information_cutoff_at", cutoff);
    expect(error).toBeNull(); expect(data?.every((row: any) => ["WATCH", "REJECT", "INSUFFICIENT_DATA"].includes(row.decision))).toBe(true);
  }, 30_000);
  it("keeps assessments immutable", async () => { const { data } = await db.from("meta_assessments").select("id").limit(1).maybeSingle(); if (!data) return; const result = await db.from("meta_assessments").update({ decision: "WATCH" }).eq("id", data.id); expect(result.error?.message).toContain("immutable"); });
});
