import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionProvider } from "@/services/execution/provider";
import { ExecutionService } from "@/services/execution/service";
import { submissionFixture } from "./support/execution-submission-fixture";

function harness(mode: "SHADOW" | "DEMO" = "SHADOW") {
  const fixture = submissionFixture(mode);
  const raw = fixture.intent;
  const intent = { source_type: raw.sourceType, source_id: raw.sourceId, asset_id: raw.assetId, instrument_id: raw.instrumentId, side: raw.side, order_type: raw.orderType, quote_amount_sek: raw.quoteAmountSek, quantity: raw.quantity, limit_price: raw.limitPrice, stop_price: raw.stopPrice, target_price: raw.targetPrice, max_slippage_bps: raw.maxSlippageBps, information_cutoff_at: raw.informationCutoffAt, available_at: raw.availableAt, expires_at: raw.expiresAt, evidence_refs: raw.evidenceRefs, consensus_version: null, forecast_version: null, risk_version: raw.riskVersion };
  const state: Record<string, any> = {
    execution_controls: fixture.control, execution_accounts: fixture.account, risk_ledger_snapshots: fixture.risk,
    account_state_observations: fixture.observation, execution_safety_evaluations: fixture.safety,
    execution_orders: [{ ...fixture.order, current_state: "SAFETY_PASSED", client_order_id: "client-1", provider_order_id: null, execution_intents: intent }],
  };
  const trace: string[] = [], events: any[] = [];
  let failingTable: string | null = null, rpcError = false, rpcHook: (() => void) | undefined;
  const db = {
    from(table: string) {
      let action = "read", values: any, single = false;
      const filters: Array<[string, unknown]> = [];
      const builder: any = {
        select() { return builder; }, eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
        lte() { return builder; }, order() { return builder; }, limit() { return builder; },
        upsert(value: unknown) { action = "upsert"; values = value; return builder; },
        update(value: unknown) { action = "update"; values = value; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
          const execute = () => {
            trace.push(`${action}:${table}`);
            if (table === failingTable) return { data: null, error: { message: "simulated read failure" } };
            if (table === "execution_order_events") { events.push(values); return { data: [], error: null }; }
            const source = state[table], rows = Array.isArray(source) ? source : source ? [source] : [];
            const matches = rows.filter((row: any) => filters.every(([key, value]) => row[key] === value));
            if (action === "update") for (const row of matches) Object.assign(row, values);
            const data = structuredClone(matches);
            return { data: single ? data[0] ?? null : data, error: null };
          };
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string, args: any): Promise<{ data: any; error: any }> => {
      if (name === "deny_execution_submission") {
        trace.push("deny-rpc");
        const order = state.execution_orders[0];
        if (order.current_state !== "SAFETY_PASSED") return { data: { blocked: false }, error: null };
        order.current_state = args.p_reason === "FINAL_PROVIDER_ORDER_ALREADY_EXISTS" ? "RECONCILIATION_REQUIRED" : args.p_reason === "FINAL_INTENT_EXPIRED" ? "EXPIRED" : "BLOCKED";
        events.push({ reason: args.p_reason, next_state: order.current_state });
        return { data: { blocked: true }, error: null };
      }
      trace.push("final-rpc"); rpcHook?.();
      if (rpcError) return { data: null, error: { message: "RPC unavailable" } };
      const control = state.execution_controls, account = state.execution_accounts, order = state.execution_orders[0];
      const reason = order.current_state !== "SAFETY_PASSED" ? "FINAL_ORDER_NOT_READY"
        : control.kill_switch ? "FINAL_KILL_SWITCH_ACTIVE"
        : !control.new_orders_enabled ? "FINAL_NEW_ORDERS_DISABLED"
        : control.revision !== args.p_control_revision ? "FINAL_CONTROL_REVISION_CHANGED"
        : account.revision !== args.p_account_revision ? "FINAL_ACCOUNT_REVISION_CHANGED"
        : state.risk_ledger_snapshots.id !== args.p_risk_snapshot_id ? "FINAL_RISK_REVISION_CHANGED_OR_UNKNOWN"
        : state.account_state_observations.id !== args.p_account_observation_id ? "FINAL_ACCOUNT_OBSERVATION_CHANGED_OR_UNKNOWN" : null;
      if (reason) { if (order.current_state === "SAFETY_PASSED") order.current_state = "BLOCKED"; return { data: { authorized: false, reason }, error: null }; }
      order.current_state = "SUBMITTING";
      return { data: { authorized: true, orderId: order.id, state: "SUBMITTING" }, error: null };
    }),
  };
  const provider: ExecutionProvider = {
    ...fixture.provider,
    health: vi.fn(async () => fixture.health as Awaited<ReturnType<ExecutionProvider["health"]>>),
    placeOrder: vi.fn(async request => { trace.push("provider.placeOrder"); return { providerOrderId: "provider-1", clientOrderId: request.clientOrderId, state: "ACKNOWLEDGED" as const, filledQuantity: 0, averagePrice: null, observedAt: fixture.checkedAt, rawReference: null }; }),
    getAccountState: vi.fn(), getOrder: vi.fn(), cancelOrder: vi.fn(),
  };
  return { state, trace, events, db, provider, service: new ExecutionService(db as unknown as SupabaseClient, provider), failTable: (table: string) => { failingTable = table; }, failRpc: () => { rpcError = true; }, atRpc: (hook: () => void) => { rpcHook = hook; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T12:00:01.000Z")); });
afterEach(() => vi.useRealTimers());

describe("final guard immediately before dispatch (no network/database)", () => {
  it("refuses DEMO credentials for a different external account", async () => {
    const h = harness("DEMO");
    vi.mocked(h.provider.health).mockResolvedValue({ status: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false, externalAccountId: "999" });
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, blocked: 1 });
    expect(h.events[0].reason).toBe("FINAL_DEMO_ACCOUNT_NOT_RECONCILED");
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it("refuses a nominal SEK budget that understates actual DEMO quantity times price", async () => {
    const h = harness("DEMO"); h.state.execution_orders[0].execution_intents.quantity = 10;
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, blocked: 1 });
    expect(h.events[0].reason).toBe("FINAL_DEMO_NOTIONAL_MISMATCH");
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it.each(["SHADOW", "DEMO"] as const)("claims then submits a valid %s order once with no awaited operation in between", async mode => {
    const h = harness(mode), result = await h.service.submitReady();
    expect(result).toMatchObject({ submitted: 1, blocked: 0, unavailable: 0 });
    expect(h.provider.placeOrder).toHaveBeenCalledOnce();
    expect(h.trace[h.trace.indexOf("final-rpc") + 1]).toBe("provider.placeOrder");
    expect(h.state.execution_orders[0].current_state).toBe("ACKNOWLEDGED");
    await h.service.submitReady();
    expect(h.provider.placeOrder).toHaveBeenCalledOnce();
  });
  it("blocks queued PASS when kill switch was enabled after enqueue", async () => {
    const h = harness(); h.state.execution_controls.kill_switch = true;
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, blocked: 1 });
    expect(h.provider.placeOrder).not.toHaveBeenCalled(); expect(h.provider.health).not.toHaveBeenCalled();
    expect(h.events[0].reason).toBe("FINAL_KILL_SWITCH_ACTIVE");
  });
  it.each(["kill", "controls", "account", "risk", "observation"])("rejects changed %s at the atomic claim boundary", async kind => {
    const h = harness(); h.atRpc(() => {
      if (kind === "kill") h.state.execution_controls.kill_switch = true;
      if (kind === "controls") h.state.execution_controls.revision++;
      if (kind === "account") h.state.execution_accounts.revision++;
      if (kind === "risk") h.state.risk_ledger_snapshots.id = "new-risk";
      if (kind === "observation") h.state.account_state_observations.id = "new-observation";
    });
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, blocked: 1 });
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it.each(["missing", "malformed", "read-error", "missing-migration"])("fails closed for %s controls", async condition => {
    const h = harness();
    if (condition === "missing") h.state.execution_controls = null;
    if (condition === "malformed") h.state.execution_controls.kill_switch = null;
    if (condition === "read-error") h.failTable("execution_controls");
    if (condition === "missing-migration") delete h.state.execution_controls.revision;
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, blocked: 1 });
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it("does not send when the final RPC fails or returns an ambiguous claim", async () => {
    const h = harness(); h.failRpc();
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, unavailable: 1 });
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
    h.db.rpc.mockResolvedValueOnce({ data: {} as any, error: null });
    expect(await h.service.submitReady()).toMatchObject({ submitted: 0, unavailable: 1 });
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it("does not fall back to an older KNOWN snapshot when newest risk is UNKNOWN", async () => {
    const h = harness(); h.state.risk_ledger_snapshots.status = "UNKNOWN";
    await h.service.submitReady();
    expect(h.db.rpc).toHaveBeenCalledWith("deny_execution_submission", expect.any(Object)); expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it("reconciles a legacy queued order with a provider reference without resending", async () => {
    const h = harness(); h.state.execution_orders[0].provider_order_id = "already-submitted";
    await h.service.submitReady();
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
    expect(h.state.execution_orders[0].current_state).toBe("RECONCILIATION_REQUIRED");
  });
  it("only one of two concurrent claimants may dispatch", async () => {
    const h = harness();
    await Promise.all([h.service.submitReady(), h.service.submitReady()]);
    expect(h.provider.placeOrder).toHaveBeenCalledOnce();
  });
  it("moves uncertain provider outcomes to reconciliation without leaking provider errors", async () => {
    const h = harness(); vi.mocked(h.provider.placeOrder).mockRejectedValue(new Error("secret-provider-request-details"));
    await h.service.submitReady();
    expect(h.state.execution_orders[0].current_state).toBe("RECONCILIATION_REQUIRED");
    expect(h.events.at(-1).reason).toBe("PROVIDER_SUBMISSION_UNCERTAIN");
    expect(JSON.stringify(h.events)).not.toContain("secret-provider-request-details");
  });
});
