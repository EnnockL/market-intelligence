import { beforeAll,describe,expect,it } from "vitest";
import { createClient,type SupabaseClient } from "@supabase/supabase-js";
const suite=process.env.RUN_SUPABASE_INTEGRATION==="1"?describe:describe.skip;let db:SupabaseClient;
suite("Supabase account state and risk ledger",()=>{
 beforeAll(()=>{db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})});
 it("persists shadow account state and deterministic risk",async()=>{const account=await db.from("execution_accounts").select("id,account_key,initial_cash_sek").eq("account_key","shadow-primary").single();expect(account.error).toBeNull();expect(Number(account.data?.initial_cash_sek)).toBe(1000);const risk=await db.from("risk_ledger_snapshots").select("status,cash_sek,reserved_exposure_sek").eq("account_id",account.data!.id).order("information_cutoff_at",{ascending:false}).limit(1).single();expect(risk.error).toBeNull();expect(risk.data?.status).toBe("KNOWN");expect(Number(risk.data?.reserved_exposure_sek)).toBe(0)});
 it("enforces immutable risk snapshots",async()=>{const row=await db.from("risk_ledger_snapshots").select("id").limit(1).single();expect(row.error).toBeNull();const update=await db.from("risk_ledger_snapshots").update({status:"UNKNOWN"}).eq("id",row.data!.id);expect(update.error?.message).toContain("immutable")});
});
