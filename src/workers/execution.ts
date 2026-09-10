import type { SupabaseClient } from "@supabase/supabase-js";
import { ExecutionService } from "@/services/execution/service";
import { ShadowExecutionProvider } from "@/services/execution/shadow-provider";
import { OkxDemoExecutionProvider } from "@/services/execution/okx-demo-provider";
import type { WorkerEnv } from "@/lib/env";
import { deterministicDigest } from "@/domain/events";
import { AccountStateService } from "@/services/execution/account-state-service";
export async function runExecution(db: SupabaseClient, env: WorkerEnv) {
  const { data: control, error } = await db.from("execution_controls")
    .select("*")
    .eq("control_key", "global")
    .single();
  if (error) throw error;
  if (control.live_execution_enabled) throw new Error("Live execution is forbidden in v1");
  if (control.mode !== env.EXECUTION_MODE) {
    throw new Error(`Execution mode mismatch: database=${control.mode}, environment=${env.EXECUTION_MODE}`);
  }

  const provider = createExecutionProvider(control.mode, env);
  const health = await provider.health();
  const status = health.status;
  const updated = await db.from("execution_controls")
    .update({ provider: provider.name, provider_status: status, updated_at: new Date().toISOString() })
    .eq("control_key", "global");
  if (updated.error) throw updated.error;

  const revisionKey = deterministicDigest({ mode: control.mode, provider: provider.name, status, health, limits: control.limits });
  const revision = await db.from("execution_control_revisions").upsert({
    revision_key: revisionKey,
    control_key: "global",
    mode: control.mode,
    new_orders_enabled: control.new_orders_enabled,
    kill_switch: control.kill_switch,
    live_execution_enabled: false,
    provider: provider.name,
    provider_status: status,
    limits: control.limits,
    reason: "PROVIDER_HEALTH_CHECK",
    available_at: new Date().toISOString(),
  }, { onConflict: "revision_key", ignoreDuplicates: true });
  if (revision.error) throw revision.error;

  const accountService = new AccountStateService(db, provider);
  if (status !== "HEALTHY") {
    // Preserve account diagnostics when possible, without reconciling or submitting orders.
    const accountState = await accountService.capture();
    return {
      mode: provider.mode,
      provider: provider.name,
      health,
      accountState,
      submitted: { submitted: 0, considered: 0 },
      reconciliation: { checked: 0, mismatches: 0, recovered: 0 },
      liveExecution: false,
    };
  }

  const service = new ExecutionService(db, provider);
  // Reconcile existing orders first. Capture then synchronizes fills and rebuilds the
  // account ledger against those states; a failure in either step prevents submission.
  const reconciliation = await service.reconcile();
  const accountState = await accountService.capture();
  // submitReady retains the final per-order guard, including current operator controls
  // and fail-closed ledger evidence. A successful capture alone never authorizes a trade.
  const submitted = await service.submitReady();
  return { mode: provider.mode, provider: provider.name, health, accountState, submitted, reconciliation, liveExecution: false };
}

export function createExecutionProvider(mode: "SHADOW" | "DEMO", env: WorkerEnv) {
  if (mode === "SHADOW") return new ShadowExecutionProvider();
  if (!env.OKX_DEMO_ENABLED) throw new Error("OKX demo requires OKX_DEMO_ENABLED=true");
  if (!env.OKX_DEMO_API_KEY || !env.OKX_DEMO_SECRET_KEY || !env.OKX_DEMO_PASSPHRASE) {
    throw new Error("OKX demo credentials are incomplete");
  }
  return new OkxDemoExecutionProvider({
    apiKey: env.OKX_DEMO_API_KEY,
    secretKey: env.OKX_DEMO_SECRET_KEY,
    passphrase: env.OKX_DEMO_PASSPHRASE,
    baseUrl: env.OKX_DEMO_BASE_URL,
  });
}
