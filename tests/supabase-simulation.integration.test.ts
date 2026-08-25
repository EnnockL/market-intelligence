import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SimulationService } from "@/services/simulation/service";
const enabled=process.env.RUN_SUPABASE_INTEGRATION==="1",suite=enabled?describe:describe.skip;let db:SupabaseClient;
suite("Supabase simulation engine",()=>{
 beforeAll(()=>{db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})});
 it("persists and reuses an immutable deterministic run",async()=>{const request={initialCapitalSek:12345,startsAt:"2026-05-01T00:00:00.000Z",endsAt:"2026-08-18T00:00:00.000Z",policy:"FIXED_SMALL" as const};const first=await new SimulationService(db).run(request),second=await new SimulationService(db).run(request);expect(second.runId).toBe(first.runId);expect(second.reused).toBe(true);const{data,error}=await db.from("simulation_runs").select("status,engine_version,simulation_results(data_status,trade_count)").eq("id",first.runId).single();expect(error).toBeNull();expect(data?.status).toBe("completed");expect(data?.engine_version).toBe("simulation-engine-v1")},20_000);
 it("enforces immutable candidate evaluations",async()=>{const{data}=await db.from("simulation_candidate_evaluations").select("id").limit(1).maybeSingle();if(!data)return;const update=await db.from("simulation_candidate_evaluations").update({reason:"MUTATED"}).eq("id",data.id);expect(update.error?.message).toContain("immutable")});
});
