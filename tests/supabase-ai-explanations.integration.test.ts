import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
let db: SupabaseClient;
suite("Supabase AI explanations v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("exposes the immutable explanation store", async () => {
    const { data, error } = await db.from("ai_explanations").select("id,entity_type,provider,model,prompt_version,evidence_refs").limit(1);
    expect(error).toBeNull(); expect(Array.isArray(data)).toBe(true);
  });
  it("registers AI explanations paused until a server key is configured", async () => {
    const { data, error } = await db.from("scheduled_jobs").select("job_type,status,enabled,rate_limit_budget").eq("job_type", "AI_EXPLANATION").single();
    expect(error).toBeNull(); expect(data).toMatchObject({ job_type: "AI_EXPLANATION", status: "PAUSED", enabled: false });
    expect(data?.rate_limit_budget.maxExplanationsPerRun).toBe(5);
  });
});
