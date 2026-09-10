import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ExecutionService } from "@/services/execution/service";
import { normalizeOrderObservation } from "@/services/execution/order-observation";
import type { ExecutionProvider, ProviderOrder } from "@/services/execution/provider";

const stamp = "2026-09-07T12:00:00.000Z";
const observed = (): ProviderOrder => ({ providerOrderId: "provider-1", clientOrderId: "client-1", state: "PARTIALLY_FILLED",
  filledQuantity: 2, averagePrice: 100, observedAt: stamp, rawReference: "provider-1" });

function harness() {
  const rows: any[] = [{ id: "order-1", current_state: "PARTIALLY_FILLED", client_order_id: "client-1", provider_order_id: "provider-1",
    reconciliation_revision: 4, execution_intents: { instrument_id: "BTC-USDT" } }];
  const writes: Array<{ table: string; data: any }> = [], reads: Array<{ method: string; args: unknown[] }> = [];
  let readError = false;
  const db = {
    from(table: string) {
      const builder: any = {};
      for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = (...args: unknown[]) => { reads.push({ method, args }); return builder; };
      builder.insert = (data: any) => { writes.push({ table, data }); return Promise.resolve({ error: null }); };
      builder.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: rows, error: readError ? { message: "private database message" } : null }).then(resolve);
      return builder;
    },
    rpc: vi.fn(async (_name: string, _args: any): Promise<{ data: any; error: any }> => ({ data: { status: "APPLIED", orderId: "order-1", state: "PARTIALLY_FILLED", revision: 5 }, error: null })),
  };
  const provider: ExecutionProvider = { name: "okx-demo", mode: "DEMO", getOrder: vi.fn(async () => observed()),
    health: vi.fn(), getAccountState: vi.fn(), placeOrder: vi.fn(), cancelOrder: vi.fn() };
  return { rows, writes, reads, db, provider, service: new ExecutionService(db as unknown as SupabaseClient, provider), failRead: () => { readError = true; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(stamp)); });
afterEach(() => vi.useRealTimers());

describe("read-only order reconciliation service", () => {
  it("persists increased fills when PARTIALLY_FILLED remains unchanged, using only an atomic RPC", async () => {
    const h = harness();
    expect(await h.service.reconcile()).toEqual({ checked: 1, mismatches: 0, recovered: 1 });
    expect(h.db.rpc).toHaveBeenCalledWith("persist_execution_order_observation", {
      p_order_id: "order-1", p_provider: "okx-demo", p_environment: "DEMO", p_instrument_id: "BTC-USDT",
      p_client_order_id: "client-1", p_expected_revision: 4,
      p_observation: { version: "execution-order-observation-v1", ...observed(), rawReference: undefined },
    });
    expect(h.writes.map(write => write.table)).toEqual(["execution_reconciliation_runs"]);
    expect(h.provider.placeOrder).not.toHaveBeenCalled(); expect(h.provider.cancelOrder).not.toHaveBeenCalled();
    expect(h.provider.getAccountState).not.toHaveBeenCalled();
    expect(h.reads).toContainEqual({ method: "order", args: ["last_provider_observed_at", { ascending: true, nullsFirst: true }] });
  });
  it.each(["DUPLICATE", "UNCHANGED"])("accepts %s without inflating recovered count", async status => {
    const h = harness(); h.db.rpc.mockResolvedValueOnce({ data: { status, orderId: "order-1" }, error: null });
    expect(await h.service.reconcile()).toMatchObject({ recovered: 0, mismatches: 0 });
  });
  it("records missing provider orders as uncertainty without manufacturing zero fills", async () => {
    const h = harness(); vi.mocked(h.provider.getOrder).mockResolvedValueOnce(null);
    h.db.rpc.mockResolvedValueOnce({ data: { status: "UNRESOLVED", orderId: "order-1" }, error: null });
    await expect(h.service.reconcile()).rejects.toThrow("EXECUTION_RECONCILIATION_INCOMPLETE");
    expect(h.db.rpc.mock.calls[0][1].p_observation).toBeNull();
    expect(h.writes[0].data).toMatchObject({ status: "DEGRADED", mismatches: 1 });
  });
  it("never treats a duplicate missing-order observation as recovery", async () => {
    const h = harness(); vi.mocked(h.provider.getOrder).mockResolvedValueOnce(null);
    h.db.rpc.mockResolvedValueOnce({ data: { status: "DUPLICATE", orderId: "order-1" }, error: null });
    await expect(h.service.reconcile()).rejects.toThrow("EXECUTION_RECONCILIATION_INCOMPLETE");
    expect(h.writes[0].data).toMatchObject({ status: "DEGRADED", mismatches: 1, recovered: 0 });
  });
  it.each(["rpc-error", "ambiguous", "wrong-order", "concurrent", "provider-error", "malformed"])("fails closed for %s without exposing errors", async kind => {
    const h = harness();
    if (kind === "rpc-error") h.db.rpc.mockResolvedValueOnce({ data: null, error: { message: "PRIVATE_TOKEN" } });
    if (kind === "ambiguous") h.db.rpc.mockResolvedValueOnce({ data: {}, error: null });
    if (kind === "wrong-order") h.db.rpc.mockResolvedValueOnce({ data: { status: "APPLIED", orderId: "other" }, error: null });
    if (kind === "concurrent") h.db.rpc.mockResolvedValueOnce({ data: { status: "REJECTED", reason: "ORDER_CHANGED_DURING_READ" }, error: null });
    if (kind === "provider-error") vi.mocked(h.provider.getOrder).mockRejectedValueOnce(new Error("PRIVATE_TOKEN"));
    if (kind === "malformed") vi.mocked(h.provider.getOrder).mockResolvedValueOnce({ ...observed(), filledQuantity: NaN });
    await expect(h.service.reconcile()).rejects.toThrow("EXECUTION_RECONCILIATION_INCOMPLETE");
    expect(JSON.stringify(h.writes)).not.toContain("PRIVATE_TOKEN");
    expect(h.writes[0].data.status).toBe("DEGRADED");
    expect(h.provider.placeOrder).not.toHaveBeenCalled();
    if (["provider-error", "malformed"].includes(kind)) expect(h.db.rpc).not.toHaveBeenCalled();
  });
  it.each([null, undefined, NaN, -1, Number.MAX_SAFE_INTEGER + 1])("requires a known revision before provider effects: %s", async revision => {
    const h = harness(); h.rows[0].reconciliation_revision = revision;
    await expect(h.service.reconcile()).rejects.toThrow("EXECUTION_RECONCILIATION_INCOMPLETE");
    expect(h.provider.getOrder).not.toHaveBeenCalled(); expect(h.db.rpc).not.toHaveBeenCalled();
  });
  it("does not treat a capped order list as complete", async () => {
    const h = harness(); h.rows.push({ ...h.rows[0], id: "order-2" });
    await expect(h.service.reconcile(1)).rejects.toThrow("EXECUTION_RECONCILIATION_INCOMPLETE");
    expect(h.provider.getOrder).toHaveBeenCalledOnce();
    expect(h.writes[0].data.details.readBudgetExceeded).toBe(true);
    expect(h.reads).toContainEqual({ method: "limit", args: [2] });
  });
  it.each([0, -1, 101, 1.5])("rejects invalid read budgets before effects: %s", async limit => {
    const h = harness(); await expect(h.service.reconcile(limit)).rejects.toThrow("RECONCILIATION_READ_BUDGET_INVALID");
    expect(h.reads).toHaveLength(0); expect(h.provider.getOrder).not.toHaveBeenCalled();
  });
  it("fails before provider reads when the migration/query is unavailable", async () => {
    const h = harness(); h.failRead(); await expect(h.service.reconcile()).rejects.toBeDefined();
    expect(h.provider.getOrder).not.toHaveBeenCalled(); expect(h.db.rpc).not.toHaveBeenCalled();
  });
});

describe("strict provider observation DTO", () => {
  it("keeps only safe typed fields", () => {
    expect(normalizeOrderObservation({ ...observed(), secret: "PRIVATE", rawReference: "PRIVATE" }, "client-1"))
      .toEqual({ version: "execution-order-observation-v1", providerOrderId: "provider-1", clientOrderId: "client-1", state: "PARTIALLY_FILLED", filledQuantity: 2, averagePrice: 100, observedAt: stamp });
  });
  it.each([null, {}, { ...observed(), state: "UNKNOWN" }, { ...observed(), filledQuantity: "2" },
    { ...observed(), filledQuantity: -1 }, { ...observed(), averagePrice: null }, { ...observed(), averagePrice: Infinity },
    { ...observed(), clientOrderId: "other" }, { ...observed(), providerOrderId: "" },
    { ...observed(), observedAt: "invalid" }, { ...observed(), observedAt: "2026-09-07T12:00:01Z" },
    { ...observed(), filledQuantity: 0, averagePrice: 100 }])("rejects ambiguous provider data %#", value => {
    expect(() => normalizeOrderObservation(value, "client-1")).toThrow("RECONCILIATION_OBSERVATION_INVALID");
  });
});
