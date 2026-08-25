import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerEnv } from "@/lib/env";
import { AccountStateService } from "@/services/execution/account-state-service";
import { createExecutionProvider } from "./execution";
export async function runAccountState(db:SupabaseClient,env:WorkerEnv){const control=await db.from("execution_controls").select("mode,live_execution_enabled").eq("control_key","global").single();if(control.error)throw control.error;if(control.data.live_execution_enabled)throw new Error("Live execution is forbidden in v1");if(control.data.mode!==env.EXECUTION_MODE)throw new Error("Execution mode mismatch");return new AccountStateService(db,createExecutionProvider(control.data.mode,env)).capture()}
