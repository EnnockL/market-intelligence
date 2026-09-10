import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "@/lib/env";
import { createExecutionProvider, runExecution } from "@/workers/execution";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  reconcile: vi.fn(),
  capture: vi.fn(),
  submitReady: vi.fn(),
}));
vi.mock("@/services/execution/service", () => ({
  ExecutionService: class { reconcile = mocks.reconcile; submitReady = mocks.submitReady; },
}));
vi.mock("@/services/execution/account-state-service", () => ({
  AccountStateService: class { capture = mocks.capture; },
}));
vi.mock("@/services/execution/shadow-provider", () => ({
  ShadowExecutionProvider: class { name = "shadow-execution"; mode = "SHADOW"; health = mocks.health; },
}));
vi.mock("@/services/execution/okx-demo-provider", () => ({
  OkxDemoExecutionProvider: class { name = "okx-demo"; mode = "DEMO"; health = mocks.health; },
}));

function setup(mode: "SHADOW" | "DEMO" = "SHADOW") {
  const events: string[] = [];
  const control = {
    mode,
    live_execution_enabled: false,
    new_orders_enabled: true,
    kill_switch: false,
    limits: { maxOrderSek: 100, maxOpenPositions: 2 },
  };
  const failures: { read: Error | null; update: Error | null; revision: Error | null } = {
    read: null, update: null, revision: null,
  };
  const updates: unknown[] = [], revisions: unknown[] = [];
  const db = { from(table: string) {
    if (table === "execution_controls") return {
      select: () => ({ eq: () => ({ single: async () => {
        events.push("control.read");
        return { data: { ...control }, error: failures.read };
      } }) }),
      update: (value: unknown) => ({ eq: async () => {
        events.push("control.update"); updates.push(value);
        return { error: failures.update };
      } }),
    };
    if (table === "execution_control_revisions") return {
      upsert: async (value: unknown) => {
        events.push("control.revision"); revisions.push(value);
        return { error: failures.revision };
      },
    };
    throw new Error(`Unexpected table: ${table}`);
  } } as unknown as SupabaseClient;
  const env = {
    EXECUTION_MODE: mode,
    OKX_DEMO_ENABLED: mode === "DEMO",
    OKX_DEMO_API_KEY: "isolated-test-key",
    OKX_DEMO_SECRET_KEY: "isolated-test-secret",
    OKX_DEMO_PASSPHRASE: "isolated-test-passphrase",
    OKX_DEMO_BASE_URL: "https://not-a-provider.invalid",
  } as WorkerEnv;
  const health = { status: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false };
  const reconciliation = { checked: 2, mismatches: 0, recovered: 1 };
  const accountState = { riskStatus: "KNOWN", riskLedgerVersion: "account-ledger-v2" };
  const submitted = { submitted: 1, considered: 1 };
  mocks.health.mockImplementation(async () => { events.push("provider.health"); return health; });
  mocks.reconcile.mockImplementation(async () => { events.push("orders.reconcile"); return reconciliation; });
  mocks.capture.mockImplementation(async () => { events.push("account.capture"); return accountState; });
  mocks.submitReady.mockImplementation(async () => { events.push("orders.submitReady"); return submitted; });
  return { events, control, failures, updates, revisions, env, health, accountState, reconciliation, submitted, invoke: () => runExecution(db, env) };
}

describe("execution worker uses reconciled account evidence before submission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in worker sequence tests"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["SHADOW", "DEMO"] as const)("orders %s health, reconciliation, account capture, then guarded submission", async (mode) => {
    const f = setup(mode);
    const result = await f.invoke();
    expect(f.events).toEqual([
      "control.read", "provider.health", "control.update", "control.revision",
      "orders.reconcile", "account.capture", "orders.submitReady",
    ]);
    expect(result).toMatchObject({ mode, health: f.health, reconciliation: f.reconciliation, accountState: f.accountState, submitted: f.submitted, liveExecution: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures the reconciled inventory and pending orders before the final guard runs", async () => {
    const f = setup();
    let reconciled = false, captured = false;
    mocks.reconcile.mockImplementation(async () => { reconciled = true; return f.reconciliation; });
    mocks.capture.mockImplementation(async () => {
      expect(reconciled).toBe(true);
      captured = true;
      return { ...f.accountState, revision: "after-reconciliation" };
    });
    mocks.submitReady.mockImplementation(async () => { expect(captured).toBe(true); return f.submitted; });
    expect(await f.invoke()).toMatchObject({ accountState: { revision: "after-reconciliation" } });
  });

  it.each(["DEGRADED", "FAILED"])("still captures diagnostics for %s without reconciling or sending orders", async (status) => {
    const f = setup(); f.health.status = status;
    const result = await f.invoke();
    expect(f.events).toEqual(["control.read", "provider.health", "control.update", "control.revision", "account.capture"]);
    expect(result).toMatchObject({ health: { status }, accountState: f.accountState, submitted: { submitted: 0, considered: 0 }, reconciliation: { checked: 0, mismatches: 0, recovered: 0 }, liveExecution: false });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.submitReady).not.toHaveBeenCalled();
  });

  it("does not submit when healthy reconciliation fails", async () => {
    const f = setup(); mocks.reconcile.mockRejectedValue(new Error("RECONCILIATION_FAILED"));
    await expect(f.invoke()).rejects.toThrow("RECONCILIATION_FAILED");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.submitReady).not.toHaveBeenCalled();
  });

  it.each(["HEALTHY", "FAILED"])("does not submit when %s account capture fails", async (status) => {
    const f = setup(); f.health.status = status;
    mocks.capture.mockRejectedValue(new Error("FILL_SYNC_OR_CAPTURE_FAILED"));
    await expect(f.invoke()).rejects.toThrow("FILL_SYNC_OR_CAPTURE_FAILED");
    expect(mocks.reconcile).toHaveBeenCalledTimes(status === "HEALTHY" ? 1 : 0);
    expect(mocks.submitReady).not.toHaveBeenCalled();
  });

  it("does not turn UNKNOWN capture into worker authorization or replace the final guard's decision", async () => {
    const f = setup();
    mocks.capture.mockResolvedValue({ riskStatus: "UNKNOWN", unknownReasons: ["FILL_HISTORY_INCOMPLETE"] });
    mocks.submitReady.mockResolvedValue({ submitted: 0, considered: 1 });
    const result = await f.invoke();
    expect(result).toMatchObject({ accountState: { riskStatus: "UNKNOWN" }, submitted: { submitted: 0, considered: 1 } });
    expect(mocks.submitReady).toHaveBeenCalledOnce();
  });

  it("preserves kill switch and disabled new-order controls, leaving enforcement to the final guard", async () => {
    const f = setup(); f.control.kill_switch = true; f.control.new_orders_enabled = false;
    mocks.submitReady.mockResolvedValue({ submitted: 0, considered: 0 });
    const result = await f.invoke();
    expect(f.revisions).toEqual([expect.objectContaining({ kill_switch: true, new_orders_enabled: false, live_execution_enabled: false })]);
    expect(f.updates).toEqual([expect.not.objectContaining({ kill_switch: false })]);
    expect(result.submitted.submitted).toBe(0);
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.submitReady).toHaveBeenCalledOnce();
  });

  it("propagates final guard failures without retrying submission", async () => {
    const f = setup(); mocks.submitReady.mockRejectedValue(new Error("FINAL_GUARD_FAILED"));
    await expect(f.invoke()).rejects.toThrow("FINAL_GUARD_FAILED");
    expect(mocks.submitReady).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it.each(["read", "update", "revision"] as const)("stops before account/order work on control %s failure", async (operation) => {
    const f = setup(); f.failures[operation] = new Error("CONTROL_FAILED");
    await expect(f.invoke()).rejects.toThrow("CONTROL_FAILED");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.submitReady).not.toHaveBeenCalled();
  });

  it("retains the unconditional live-execution prohibition", async () => {
    const f = setup(); f.control.live_execution_enabled = true;
    await expect(f.invoke()).rejects.toThrow("Live execution is forbidden");
    expect(f.events).toEqual(["control.read"]);
  });

  it("rejects environment/database mode mismatch before provider access", async () => {
    const f = setup(); f.env.EXECUTION_MODE = "DEMO";
    await expect(f.invoke()).rejects.toThrow("Execution mode mismatch");
    expect(f.events).toEqual(["control.read"]);
  });

  it("does not add a demo path without explicit enablement and complete credentials", () => {
    const f = setup();
    expect(() => createExecutionProvider("DEMO", f.env)).toThrow("OKX_DEMO_ENABLED=true");
    f.env.OKX_DEMO_ENABLED = true; f.env.OKX_DEMO_PASSPHRASE = undefined;
    expect(() => createExecutionProvider("DEMO", f.env)).toThrow("credentials are incomplete");
    expect(mocks.health).not.toHaveBeenCalled();
  });
});
