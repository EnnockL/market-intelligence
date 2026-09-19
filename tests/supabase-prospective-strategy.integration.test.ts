import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const suite=process.env.RUN_SUPABASE_INTEGRATION==="1"?describe:describe.skip;
let db:SupabaseClient;
suite("prospective strategy API boundary",()=>{
  beforeAll(()=>{db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});});
  it("exposes the immutable stores and rejects retrospective registration through PostgREST",async()=>{
    for(const table of ["strategy_dataset_plans","strategy_frozen_datasets"]){const r=await db.from(table).select("id").limit(1);expect(r.error).toBeNull();}
    const r=await db.rpc("register_strategy_dataset",{p_definition_id:randomUUID(),p_asset_id:randomUUID(),p_provider:"fixture",p_starts_at:"2026-01-01T00:00:00Z",p_ends_at:"2026-02-01T00:00:00Z"});
    expect(r.error?.message).toContain("PROSPECTIVE_WINDOW_REQUIRED");
  });
  it("does not expose a dataset or publish a run without a registered completed window",async()=>{
    const seal=await db.rpc("seal_strategy_dataset",{p_plan_id:randomUUID()});
    expect(seal.error?.message).toContain("PROSPECTIVE_WINDOW_NOT_COMPLETE");
    const publish=await db.rpc("publish_frozen_strategy_evaluation",{p_run:{},p_trades:[],p_segments:[]});
    expect(publish.error?.message).toContain("FROZEN_PUBLICATION_INCOMPLETE");
  });
});
