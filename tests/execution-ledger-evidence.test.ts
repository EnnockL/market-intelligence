import { describe, expect, it } from "vitest";
import { contiguousFillCoverage, finiteNumber, historicalSekRate, normalizeLedgerFill, persistedLedgerRisk, remainingOrderReservation } from "@/services/execution/ledger-evidence";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";

const baseline = "2026-09-01T00:00:00.000Z", at = "2026-09-07T12:00:00.000Z";
const fx = { id: "fx1", base_currency: "USD", quote_currency: "SEK", rate: "10", effective_at: "2026-09-07T00:00:00.000Z", observed_at: "2026-09-07T00:00:00.000Z", available_at: "2026-09-07T01:00:00.000Z", data_quality: 100, provider: "test", source_reference: "fx-test" };
const fill = { id: "f1", account_id: "a", instrument_id: "BTC-USD", side: "BUY", quantity: "1", price: "100", fee_amount: "2", fee_currency: "USD", base_currency: "BTC", quote_currency: "USD", occurred_at: at, available_at: at };
const state = { id: "s1", status: "COMPLETE_WINDOW", source: "OKX_FILLS_HISTORY_3_MONTHS", time_basis: "PROVIDER_RECORDED_AT", retention_limited: false, exhausted: true, requested_start_at: baseline, requested_end_at: at, effective_start_at: baseline, effective_end_at: at, retention_start_at: "2026-06-07T00:00:00.000Z", observed_at: at };

describe("account ledger evidence boundaries", () => {
  it("converts price and signed quote fee with evidenced historical FX", () => {
    expect(normalizeLedgerFill(fill, at, [fx])).toMatchObject({ fill: { priceSek: 1000, feeSek: 20, feeAsset: "QUOTE", feeBaseQuantity: null }, fxReference: "fx_observations:fx1:test:fx-test" });
    expect(normalizeLedgerFill({ ...fill, fee_amount: "-2" }, at, [fx]).fill.feeSek).toBe(-20);
  });
  it("keeps base fee quantity for inventory and never debits it as cash twice", () => {
    expect(normalizeLedgerFill({ ...fill, fee_currency: "BTC", fee_amount: "0.001" }, at, [fx]).fill).toMatchObject({ priceSek: 1000, feeAsset: "BASE", feeBaseQuantity: 0.001, feeSek: 1 });
  });
  it.each(["USDT", "USDC"])("does not substitute USD parity for %s", currency => {
    expect(historicalSekRate(currency, at, at, [fx])).toBeNull();
  });
  it("does not manufacture zero missing fees or value third-currency fees", () => {
    expect(normalizeLedgerFill({ ...fill, fee_amount: null }, at, [fx]).fill.feeSek).toBeNull();
    expect(normalizeLedgerFill({ ...fill, fee_currency: "OKB" }, at, [fx]).fill).toMatchObject({ feeAsset: "UNKNOWN", feeSek: null });
    expect(normalizeLedgerFill({ ...fill, fee_amount: "0" }, at, [fx]).fill.feeSek).toBe(0);
  });
  it.each([
    { available_at: "2026-09-08T00:00:00.000Z" }, { effective_at: "2026-09-08T00:00:00.000Z" },
    { effective_at: "2026-08-01T00:00:00.000Z" }, { data_quality: null }, { data_quality: 79 }, { rate: "NaN" }, { rate: "0" },
  ])("rejects unavailable/old/bad FX %j", delta => expect(historicalSekRate("USD", at, at, [{ ...fx, ...delta }])).toBeNull());
  it("rejects conflicting same-time FX, rather than choosing a favorable quote", () => expect(historicalSekRate("USD", at, at, [fx, { ...fx, id: "fx2", rate: "11" }])).toBeNull());
  it("requires contiguous, fully finished provider windows", () => {
    expect(contiguousFillCoverage(baseline, [state], at)).toEqual({ through: at, checkpointIds: ["s1"] });
    for (const delta of [{ status: "PARTIAL" }, { status: "RETENTION_GAP" }, { exhausted: false }, { observed_at: "2026-09-08T00:00:00.000Z" }, { effective_start_at: "2026-09-02T00:00:00.000Z" }]) {
      expect(contiguousFillCoverage(baseline, [{ ...state, ...delta }], at)).toBeNull();
    }
  });
  it("retains completed old windows when newer windows have a later retention floor", () => {
    const middle = "2026-09-03T00:00:00.000Z";
    expect(contiguousFillCoverage(baseline, [{ ...state, effective_end_at: middle, requested_end_at: middle }, { ...state, id: "s2", requested_start_at: middle, effective_start_at: middle, retention_start_at: middle }], at)).toEqual({ through: at, checkpointIds: ["s1", "s2"] });
  });
  it("reserves remaining quantity/notional once, plus an explicit fee buffer", () => {
    const order = { id: "o", account_id: "a", filled_quantity: "0.4", reservation_fee_buffer_sek: "2", updated_at: at, execution_intents: { side: "BUY", instrument_id: "BTC-USD", quantity: "1", quote_amount_sek: "100" } };
    expect(remainingOrderReservation(order)).toMatchObject({ remainingQuantity: 0.6, remainingNotionalSek: 62 });
    expect(remainingOrderReservation({ ...order, reservation_fee_buffer_sek: null }).remainingNotionalSek).toBeNull();
    expect(remainingOrderReservation({ ...order, filled_quantity: "2" }).remainingQuantity).toBeNull();
  });
  it.each([null, undefined, "", "  ", NaN, Infinity, "Infinity", true, {}, []].map(value => [value]))("does not coerce unknown %s to zero", value => expect(finiteNumber(value)).toBeNull());
  it("bridge requires a fresh, account-bound v2 payload and never accepts legacy KNOWN", () => {
    const ledger = rebuildAccountLedgerV2({ accountId: "a", baselineAt: baseline, openingCashSek: 1000, openingCashStatus: "DECLARED", historyComplete: true, cutoffAt: at, dailyWindowStartAt: "2026-09-07T00:00:00.000Z", fills: [], marks: [], pendingOrders: [] });
    const row = { account_id: "a", ledger_version: ledger.version, ledger_payload: ledger, status: "KNOWN", unknown_reasons: [], information_cutoff_at: at, economic_cutoff_at: at, available_at: at };
    expect(persistedLedgerRisk(row, "a", at, 15000)).toMatchObject({ status: "KNOWN", availableCashSek: 1000, totalExposureSek: 0 });
    for (const delta of [{ ledger_version: "risk-ledger-v1" }, { status: "UNKNOWN" }, { account_id: "other" }, { economic_cutoff_at: baseline }, { ledger_payload: { ...ledger, cashSek: 9999 } }, { available_at: "2026-09-08T00:00:00.000Z" }]) {
      expect(persistedLedgerRisk({ ...row, ...delta }, "a", at, 15000).status).toBe("UNKNOWN");
    }
    expect(persistedLedgerRisk(row, "a", "2026-09-07T12:01:00.000Z", 15000).status).toBe("UNKNOWN");
  });
});
