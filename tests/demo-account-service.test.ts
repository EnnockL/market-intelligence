import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DemoAccountService } from "@/services/execution/demo-account-service";
import type { ExecutionProvider } from "@/services/execution/provider";
import type { DemoAccountEvidence } from "@/services/execution/account-evidence";
import { verifyAccountLedgerV2Snapshot, riskContextFromAccountLedgerV2 } from "@/domain/account-ledger-v2";
import { createDemoBaseline } from "@/domain/demo-account-reconciliation";
const sync = vi.hoisted(() => vi.fn());
vi.mock("@/services/execution/fill-sync-service", () => ({ ExecutionFillSyncService: class { syncAccount = sync; } }));
const at = "2026-09-19T10:00:00.000Z", now = "2026-09-19T11:00:00.000Z";
function fixture() {
  const account = { id: "a", account_key: "okx-demo-primary", provider: "okx-demo", provider_environment: "DEMO", revision: 2, status: "PAUSED", provider_account_id: "123",
    demo_baseline: { version: "demo-account-baseline-v1", externalAccountId: "123", instrumentId: "BTC-USD", baseCurrency: "BTC", quoteCurrency: "USD", cash: 1000, at, evidenceHash: "a".repeat(64) } };
  const evidence: DemoAccountEvidence = { version: "demo-account-evidence-v1", externalAccountId: "123", instrumentId: "BTC-USD", baseCurrency: "BTC", quoteCurrency: "USD",
    startedAt: now, observedAt: now, windowStart: at, complete: true, balances: [{ currency: "USD", total: 1000, available: 1000 }], orders: [], bills: [], mark: { price: 50000, observedAt: now }, feeRate: 0.001 };
  const data: Record<string, any[]> = { execution_fills: [], execution_orders: [], fx_observations: [{ id: "fx", base_currency: "USD", quote_currency: "SEK", rate: 10,
    effective_at: at, observed_at: at, available_at: at, provider: "fixture", source_reference: "fx-reference", data_quality: 100 }] };
  const rpc = vi.fn(async (_name: string, _args: any): Promise<{ data: any; error: any }> => ({ data: { saved: true }, error: null }));
  const db = { rpc, from(table: string) { const builder: any = {
    select() { return builder; }, eq() { return builder; }, gte() { return builder; }, lte() { return builder; }, order() { return builder; }, range() { return builder; },
    then(resolve: any) { return Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve); },
  }; return builder; } };
  const provider = { name: "okx-demo", mode: "DEMO", health: vi.fn(async () => ({ status: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false, externalAccountId: "123" })),
    getAccountEvidence: vi.fn(async () => evidence), placeOrder: vi.fn() } as unknown as ExecutionProvider;
  return { account, evidence, data, rpc, provider, service: new DemoAccountService(db as unknown as SupabaseClient, provider) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); sync.mockReset(); sync.mockResolvedValue({ status: "COMPLETE_WINDOW" }); });
afterEach(() => vi.useRealTimers());
describe("demo capture publication", () => {
  it("values all six opening holdings, keeps foreign cash out of EUR buying power and labels the reference basis", async () => {
    const h = fixture();
    Object.assign(h.evidence, { instrumentId: "BTC-EUR", baseCurrency: "BTC", quoteCurrency: "EUR",
      balances: [{ currency: "EUR", total: 1000, available: 1000 }, { currency: "USD", total: 100, available: 100 },
        { currency: "BTC", total: 1, available: 1 }, { currency: "ETH", total: 2, available: 2 },
        { currency: "XRP", total: 10, available: 10 }, { currency: "USDC", total: 100, available: 100 }],
      holdingMarks: [{ currency: "ETH", instrumentId: "ETH-EUR", quoteCurrency: "EUR", price: 2000, observedAt: now },
        { currency: "XRP", instrumentId: "XRP-EUR", quoteCurrency: "EUR", price: 2, observedAt: now },
        { currency: "USDC", instrumentId: "USDC-EUR", quoteCurrency: "EUR", price: 0.9, observedAt: now }] });
    const opening = structuredClone(h.evidence); opening.startedAt = at; opening.observedAt = at; opening.mark.observedAt = at;
    opening.holdingMarks!.forEach(x => x.observedAt = at);
    Object.assign(h.account.demo_baseline, createDemoBaseline(opening, true));
    h.data.fx_observations.push({ ...h.data.fx_observations[0], id: "eur", base_currency: "EUR", rate: 11 });
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "KNOWN", cashSek: 11000, openPositions: 5 });
    const snapshot = h.rpc.mock.calls[0][1].p_snapshot;
    expect(snapshot.pnlScope).toBe("SINCE_OBSERVED_BASELINE_NOT_HISTORICAL_COST");
    expect(snapshot.grossExposureSek).toBe(596210);
    expect(snapshot.realizedPnlSek).toBe(0);
    expect(riskContextFromAccountLedgerV2(snapshot)).toMatchObject({ availableCashSek: 11000,
      availableSellQuantity: expect.objectContaining({ "BTC-EUR": 1, "ETH-EUR": 2, "XRP-EUR": 10, "USDC-EUR": 100 }) });
    h.evidence.holdingMarks = h.evidence.holdingMarks!.filter(x => x.currency !== "USDC");
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "UNKNOWN", unknownReasons: expect.arrayContaining(["DEMO_HOLDING_MARK_REQUIRED"]) });
  });
  it("produces a KNOWN ledger from reconciled cash, exact FX and a quiet provider account", async () => {
    const h = fixture(), result = await h.service.capture(h.account);
    expect(result).toMatchObject({ riskStatus: "KNOWN", cashSek: 10000, unknownReasons: [] });
    expect(h.rpc).toHaveBeenCalledOnce();
    const [name, args] = h.rpc.mock.calls[0];
    expect(name).toBe("publish_demo_account_capture"); expect(args.p_revision).toBe(2);
    expect(verifyAccountLedgerV2Snapshot(args.p_snapshot)).toBe(true);
    expect(h.account.status).toBe("PAUSED"); expect(h.provider.placeOrder).not.toHaveBeenCalled();
  });
  it("checks external identity before ingesting any fills into the bound account", async () => {
    const h = fixture(); vi.mocked(h.provider.health).mockResolvedValue({ status: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false, externalAccountId: "999" });
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "UNKNOWN", unknownReasons: expect.arrayContaining(["DEMO_ACCOUNT_IDENTITY_CHANGED"]) });
    expect(sync).not.toHaveBeenCalled();
  });
  it("publishes a newer UNKNOWN instead of retaining an old KNOWN result when the provider fails", async () => {
    const h = fixture(); vi.mocked(h.provider.getAccountEvidence!).mockRejectedValue(new Error("secret-url-key"));
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "UNKNOWN" });
    expect(h.rpc).toHaveBeenCalledOnce(); expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("secret-url-key");
  });
  it("requires complete fill coverage and does not fetch fresh account evidence on a partial scan", async () => {
    const h = fixture(); sync.mockResolvedValue({ status: "PARTIAL" });
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "UNKNOWN", unknownReasons: expect.arrayContaining(["DEMO_FILL_HISTORY_PARTIAL"]) });
    expect(h.provider.getAccountEvidence).not.toHaveBeenCalled();
  });
  it("does not invent SEK conversion when direct quote-currency evidence is absent", async () => {
    const h = fixture(); h.data.fx_observations = [];
    expect(await h.service.capture(h.account)).toMatchObject({ riskStatus: "UNKNOWN", unknownReasons: expect.arrayContaining(["DEMO_DIRECT_QUOTE_SEK_FX_REQUIRED"]) });
  });
  it("propagates atomic publication failures without reporting a completed capture", async () => {
    const h = fixture(); h.rpc.mockResolvedValue({ data: null, error: new Error("revision changed") });
    await expect(h.service.capture(h.account)).rejects.toThrow("revision changed");
  });
});
