import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOkxAccountEvidence } from "@/services/execution/okx-account-evidence";
const now = "2026-09-19T12:00:00.000Z", start = "2026-09-19T11:00:00.000Z";
function provider(overrides: (path: string, result: any[], call: number) => any[] = (_p, r) => r) {
  let calls = 0;
  return vi.fn(async (path: string): Promise<unknown[]> => {
    const route = path.split("?")[0];
    const data: Record<string, any[]> = {
      "/api/v5/account/config": [{ uid: "123", acctLv: "1", autoLoan: false }],
      "/api/v5/account/instruments": [{ instId: "BTC-USDT", instType: "SPOT", baseCcy: "BTC", quoteCcy: "USDT", state: "live", lotSz: "0.00001", minSz: "0.00001", tickSz: "0.1", groupId: "1" }],
      "/api/v5/account/trade-fee": [{ instType: "SPOT", feeGroup: [{ groupId: "1", maker: "-0.0008", taker: "-0.001" }] }],
      "/api/v5/account/balance": [{ details: [{ ccy: "USDT", cashBal: "1000", availBal: "1000", liab: "0" }] }],
      "/api/v5/trade/orders-pending": [], "/api/v5/trade/orders-algo-pending": [], "/api/v5/account/bills-archive": [],
      "/api/v5/market/ticker": [{ instId: "BTC-USDT", bidPx: "50000", askPx: "50001", ts: String(Date.parse(now)) }],
    };
    if (!data[route]) throw new Error(`Unexpected route ${route}`);
    return overrides(path, structuredClone(data[route]), ++calls);
  });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
describe("OKX account evidence", () => {
  it("reads a quiet spot account with explicit instrument and fee metadata", async () => {
    const read = provider(), result = await readOkxAccountEvidence(read, "BTC-USDT", start);
    expect(result).toMatchObject({ externalAccountId: "123", complete: true, feeRate: 0.001, mark: { price: 50000 }, bills: [], orders: [] });
    expect(read.mock.calls.every(([path]) => path.startsWith("/api/v5/"))).toBe(true);
  });
  it("accepts an empty margin-only liability field in verified spot mode", async () => {
    const read = provider((path, result) => path.endsWith("/balance") ? [{ details: [{ ccy: "USDT", cashBal: "1000", availBal: "1000", liab: "" }] }] : result);
    expect((await readOkxAccountEvidence(read, "BTC-USDT", start)).complete).toBe(true);
  });
  it.each([
    ["missing amount", "/api/v5/account/balance", [{ details: [{ ccy: "USDT", availBal: "1000" }] }], "INVALID_AMOUNT"],
    ["unmapped holding", "/api/v5/account/balance", [{ details: [{ ccy: "ETH", cashBal: "1", availBal: "1" }] }], "HOLDING_MARKET_UNAVAILABLE"],
    ["margin mode", "/api/v5/account/config", [{ uid: "123", acctLv: "2" }], "SPOT_ACCOUNT_REQUIRED"],
    ["stale price", "/api/v5/market/ticker", [{ instId: "BTC-USDT", bidPx: "1", ts: String(Date.parse(now) - 120000) }], "MARK_UNAVAILABLE_OR_STALE"],
    ["algorithmic order", "/api/v5/trade/orders-algo-pending", [{ algoId: "1" }], "ALGO_ORDERS_UNSUPPORTED"],
  ])("rejects %s", async (_label, route, data, reason) => {
    const read = provider((path, result) => path.startsWith(route as string) ? data as any[] : result);
    await expect(readOkxAccountEvidence(read, "BTC-USDT", start)).rejects.toThrow(reason as string);
  });
  it("rejects a credential account changing during capture", async () => {
    let configs = 0;
    const read = provider((path, result) => path.endsWith("/config") && ++configs === 2 ? [{ uid: "999", acctLv: "1" }] : result);
    await expect(readOkxAccountEvidence(read, "BTC-USDT", start)).rejects.toThrow("ACCOUNT_CHANGED_DURING_CAPTURE");
  });
  it("rejects a changing balance", async () => {
    let balances = 0;
    const read = provider((path, result) => path.endsWith("/balance") && ++balances === 2 ? [{ details: [{ ccy: "USDT", cashBal: "999", availBal: "999" }] }] : result);
    await expect(readOkxAccountEvidence(read, "BTC-USDT", start)).rejects.toThrow("ACCOUNT_CHANGED_DURING_CAPTURE");
  });
  it("does not treat an expired history window as empty verified history", async () => {
    const read = provider();
    await expect(readOkxAccountEvidence(read, "BTC-USDT", "2026-01-01T00:00:00Z")).rejects.toThrow("BASELINE_OUTSIDE_RETENTION");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects unknown manual pending orders", async () => {
    const read = provider((path, result) => path.startsWith("/api/v5/trade/orders-pending") ? [{ ordId: "1", instType: "SWAP" }] : result);
    await expect(readOkxAccountEvidence(read, "BTC-USDT", start)).rejects.toThrow("UNSUPPORTED_PENDING_ORDER");
  });
});
