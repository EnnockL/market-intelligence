import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { QualificationDiagnosticsService } from "@/services/qualification/service";
const enabled=process.env.RUN_SUPABASE_INTEGRATION==="1",suite=enabled?describe:describe.skip;let db:SupabaseClient;
suite("Supabase qualification diagnostics",()=>{
  beforeAll(()=>{db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})});
  it("rebuilds candidate evaluations idempotently",async()=>{const service=new QualificationDiagnosticsService(db),first=await service.run("2026-08-17T23:59:59.000Z"),second=await service.run("2026-08-17T23:59:59.000Z");expect(first.revisions).toBeGreaterThanOrEqual(0);expect(second.created).toBe(0)},60_000);
  it("enforces immutable evaluations in PostgreSQL",async()=>{const {data,error}=await db.from("qualification_evaluations").select("id").limit(1).maybeSingle();expect(error).toBeNull();if(!data)return;const update=await db.from("qualification_evaluations").update({eligible_next_state:"QUALIFIED"}).eq("id",data.id);expect(update.error?.message).toContain("immutable")});
});
