import { describe, expect, it } from "vitest";
import { createDemoBaseline, reconcileDemoAccount, type NativeFill } from "@/domain/demo-account-reconciliation";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";
import type { DemoAccountBaseline, DemoAccountEvidence } from "@/services/execution/account-evidence";

const at = "2026-09-19T10:00:00.000Z", now = "2026-09-19T11:00:00.000Z", tradeAt = "2026-09-19T10:30:00.000Z";
const baseline: DemoAccountBaseline = { version: "demo-account-baseline-v1", externalAccountId: "123", instrumentId: "BTC-USDT", baseCurrency: "BTC", quoteCurrency: "USDT", cash: 1000, at, evidenceHash: "a".repeat(64) };
function evidence(): DemoAccountEvidence {
  return { version: "demo-account-evidence-v1", externalAccountId: "123", instrumentId: "BTC-USDT", baseCurrency: "BTC", quoteCurrency: "USDT", windowStart: at,
    startedAt: now, observedAt: now, complete: true, balances: [{ currency: "USDT", total: 899, available: 899 }, { currency: "BTC", total: 1, available: 1 }],
    orders: [], bills: [
      { id: "11", currency: "BTC", change: 1, balance: 1, type: "2", orderId: "5", occurredAt: tradeAt },
      { id: "12", currency: "USDT", change: -101, balance: 899, type: "2", orderId: "5", occurredAt: tradeAt },
    ], mark: { price: 110, observedAt: now }, feeRate: 0.001 };
}
const fill: NativeFill = { id: "f", provider_order_id: "5", instrument_id: "BTC-USDT", base_currency: "BTC", quote_currency: "USDT", side: "BUY", quantity: 1, price: 100, fee_amount: 1, fee_currency: "USDT", occurred_at: tradeAt };

describe("native demo account reconciliation", () => {
  it("preserves existing inventory and detects unrecorded changes in passive holdings", () => {
    const e = evidence(); e.bills = []; e.balances = [{ currency: "USDT", total: 1000, available: 1000 },
      { currency: "BTC", total: 2, available: 2 }, { currency: "ETH", total: 3, available: 3 }];
    e.startedAt = at;
    const opening = createDemoBaseline(structuredClone(e), true);
    expect(reconcileDemoAccount(opening, e, [])).toMatchObject({ base: 2, cash: 1000 });
    e.balances[2].total = 4;
    expect(() => reconcileDemoAccount(opening, e, [])).toThrow("PROVIDER_BALANCE_MISMATCH");
  });
  it("can sell opening inventory and reports only performance relative to its observed reference", () => {
    const snapshot = rebuildAccountLedgerV2({ accountId: "a", baselineAt: at, openingCashSek: 1000, openingCashStatus: "DECLARED", historyComplete: true,
      openingInventory: [{ instrumentId: "BTC-EUR", quantity: 2, referencePriceSek: 100 }], cutoffAt: now, dailyWindowStartAt: at,
      fills: [{ fillId: "sell", accountId: "a", instrumentId: "BTC-EUR", side: "SELL", quantity: 1, priceSek: 90,
        feeSek: 1, feeAsset: "QUOTE", feeBaseQuantity: null, occurredAt: tradeAt, availableAt: tradeAt }],
      marks: [{ instrumentId: "BTC-EUR", priceSek: 90, observedAt: now, availableAt: now }], pendingOrders: [] });
    expect(snapshot).toMatchObject({ status: "KNOWN", pnlScope: "SINCE_OBSERVED_BASELINE_NOT_HISTORICAL_COST", realizedPnlSek: -11,
      cashSek: 1089, grossExposureSek: 90, positions: [expect.objectContaining({ quantity: 1, costBasisSek: 100 })] });
  });
  it("matches bills, individual fills, fees and actual currency balances", () => {
    expect(reconcileDemoAccount(baseline, evidence(), [fill])).toMatchObject({ cash: 899, base: 1 });
  });
  it("rejects missing fills even when provider balances look plausible", () => {
    expect(() => reconcileDemoAccount(baseline, evidence(), [])).toThrow("BILLS_AND_FILLS_DISAGREE");
  });
  it("rejects duplicated fills and bills", () => {
    expect(() => reconcileDemoAccount(baseline, evidence(), [fill, fill])).toThrow("DUPLICATE_FILL");
    const e = evidence(); e.bills.push(e.bills[0]);
    expect(() => reconcileDemoAccount(baseline, e, [fill])).toThrow("DUPLICATE_BILL");
  });
  it("does not bind a second external account to the original baseline", () => {
    expect(() => reconcileDemoAccount(baseline, { ...evidence(), externalAccountId: "999" }, [fill])).toThrow("ACCOUNT_IDENTITY_CHANGED");
  });
  it("detects an omitted movement via the bill running balance", () => {
    const e = evidence(); e.bills[1].balance = 900;
    expect(() => reconcileDemoAccount(baseline, e, [fill])).toThrow("BILL_BALANCE_CHAIN_MISMATCH");
  });
  it("detects a provider balance changed after the bills", () => {
    const e = evidence(); e.balances[0].total = 901;
    expect(() => reconcileDemoAccount(baseline, e, [fill])).toThrow("PROVIDER_BALANCE_MISMATCH");
  });
  it("keeps USD and USDT distinct", () => {
    expect(() => reconcileDemoAccount(baseline, evidence(), [{ ...fill, quote_currency: "USD" }])).toThrow("FILL_SCOPE_INVALID");
  });
  it("accounts for cash transfers without inventing a trade", () => {
    const e = evidence(); e.bills.push({ id: "13", currency: "USDT", change: 50, balance: 949, type: "1", orderId: "", occurredAt: now });
    e.balances[0] = { currency: "USDT", total: 949, available: 949 };
    expect(reconcileDemoAccount(baseline, e, [fill]).cash).toBe(949);
  });
  it("rejects unsupported noncash deposits", () => {
    const e = evidence(); e.bills.push({ id: "13", currency: "BTC", change: 1, balance: 2, type: "1", orderId: "", occurredAt: now });
    expect(() => reconcileDemoAccount(baseline, e, [fill])).toThrow("UNSUPPORTED_FUNDING_MOVEMENT");
  });
  it("reconciles base-denominated fees without charging quote cash twice", () => {
    const e = evidence(); e.bills[0] = { ...e.bills[0], change: 0.99, balance: 0.99 }; e.bills[1] = { ...e.bills[1], change: -100, balance: 900 };
    e.balances = [{ currency: "USDT", total: 900, available: 900 }, { currency: "BTC", total: 0.99, available: 0.99 }];
    expect(reconcileDemoAccount(baseline, e, [{ ...fill, fee_currency: "BTC", fee_amount: 0.01 }])).toMatchObject({ cash: 900, base: 0.99 });
  });
  it("reserves only the remaining portion of an external order", () => {
    const e = evidence(); e.orders.push({ id: "8", instrumentId: "BTC-USDT", side: "SELL", quantity: 0.75, filled: 0.25, price: 120, updatedAt: now });
    e.balances[1].available = 0.5;
    expect(reconcileDemoAccount(baseline, e, [fill]).base).toBe(1);
    e.balances[1].available = 0.4;
    expect(() => reconcileDemoAccount(baseline, e, [fill])).toThrow("UNEXPLAINED_FROZEN_BALANCE");
  });
  it("only starts from observed, unreserved cash and zero inventory", () => {
    const e = evidence();
    expect(() => createDemoBaseline(e)).toThrow("QUIET_BASELINE_REQUIRED");
    e.bills = [];
    expect(() => createDemoBaseline(e)).toThrow("ZERO_OPENING_INVENTORY_REQUIRED");
    e.balances = [{ currency: "USDT", total: 1000, available: 1000 }];
    expect(createDemoBaseline(e)).toMatchObject({ cash: 1000, externalAccountId: "123" });
  });
  it("uses reconciled native cash for spending but historical FX for PnL", () => {
    const result = rebuildAccountLedgerV2({ accountId: "account", baselineAt: at, openingCashSek: 10000, openingCashStatus: "DECLARED", historyComplete: true,
      cutoffAt: now, dailyWindowStartAt: at, pendingOrders: [],
      cashReconciliation: { cashSek: 10788, evidenceHash: "a".repeat(64) },
      fills: [{ fillId: "f", accountId: "account", instrumentId: "BTC-USDT", side: "BUY", quantity: 1, priceSek: 1000, feeSek: 10, feeAsset: "QUOTE", feeBaseQuantity: null, occurredAt: tradeAt, availableAt: tradeAt }],
      marks: [{ instrumentId: "BTC-USDT", priceSek: 1320, observedAt: now, availableAt: now }] });
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 10788, realizedPnlSek: 0, feesSek: 10, grossExposureSek: 1320 });
    expect(result.positions[0].costBasisSek).toBe(1010);
  });
});
