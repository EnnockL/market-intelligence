import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AgentPerformanceService } from "@/services/agent-performance/service";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
let db: SupabaseClient;

suite("Supabase agent performance v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("is idempotent at the same point-in-time cutoff", async () => {
    const cutoff = "2026-08-18T23:59:59.000Z", service = new AgentPerformanceService(db);
    const first = await service.run(cutoff), second = await service.run(cutoff);
    expect(first.created).toBeGreaterThanOrEqual(0);
    expect(second.created).toBe(0);
    const { data, error } = await db.from("agent_performance_snapshots").select("status,metrics,sample_size,independent_edge").eq("information_cutoff_at", cutoff);
    expect(error).toBeNull();
    expect(data?.every((row: any) => row.sample_size >= 0)).toBe(true);
  }, 30_000);
  it("keeps historical performance immutable", async () => {
    const { data } = await db.from("agent_performance_snapshots").select("id").limit(1).maybeSingle();
    if (!data) return;
    const result = await db.from("agent_performance_snapshots").update({ sample_size: 999 }).eq("id", data.id);
    expect(result.error?.message).toContain("immutable");
  });
});
