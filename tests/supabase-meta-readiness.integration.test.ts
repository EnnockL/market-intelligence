import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MetaReadinessService } from "@/services/meta-readiness/service";
const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip; let db: SupabaseClient;
suite("Supabase meta readiness v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("persists a deterministic readiness snapshot", async () => { const cutoff = new Date().toISOString(), service = new MetaReadinessService(db); const first = await service.run(cutoff), second = await service.run(cutoff); expect(["READY", "COLLECTING", "BLOCKED"]).toContain(first.status); expect(second.created).toBe(0); });
  it("keeps readiness history immutable", async () => { const { data } = await db.from("meta_readiness_snapshots").select("id").limit(1).maybeSingle(); if (!data) return; const response = await db.from("meta_readiness_snapshots").update({ status: "READY" }).eq("id", data.id); expect(response.error?.message).toContain("immutable"); });
});
