import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip; let db: SupabaseClient;
suite("Supabase scheduler dependency order v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("registers the missing specialist producer and ordered research stages", async () => { const { data, error } = await db.from("scheduled_jobs").select("job_type,priority").in("job_type", ["SPECIALIST_AGENTS", "CONSENSUS", "META_AGENT", "META_READINESS"]).order("priority"); expect(error).toBeNull(); expect(data?.map((item) => item.job_type)).toEqual(["SPECIALIST_AGENTS", "CONSENSUS", "META_AGENT", "META_READINESS"]); });
});
