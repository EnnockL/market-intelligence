import { describe, expect, it } from "vitest";
import { rebuildAccountLedgerV2, riskContextFromAccountLedgerV2, verifyAccountLedgerV2Snapshot, type AccountLedgerV2Input, type LedgerFillV2, type LedgerMarkV2, type PendingOrderV2 } from "@/domain/account-ledger-v2";

const cutoffAt = "2026-09-07T12:00:00.000Z";
const dayStart = "2026-09-07T00:00:00.000Z";
const yesterday = "2026-09-06T10:00:00.000Z";
const today = "2026-09-07T10:00:00.000Z";
const mark = (instrumentId = "BTC-EUR", priceSek = 150, extra: Partial<LedgerMarkV2> = {}): LedgerMarkV2 => ({ instrumentId, priceSek, observedAt: "2026-09-07T11:59:00.000Z", availableAt: cutoffAt, ...extra });
const fill = (extra: Partial<LedgerFillV2> = {}): LedgerFillV2 => ({ fillId: "fill-1", accountId: "account", instrumentId: "BTC-EUR", side: "BUY", quantity: 1, priceSek: 100, feeSek: 0, feeAsset: "QUOTE", feeBaseQuantity: null, occurredAt: yesterday, availableAt: yesterday, ...extra });
const pending = (extra: Partial<PendingOrderV2> = {}): PendingOrderV2 => ({ orderId: "pending-1", accountId: "account", instrumentId: "BTC-EUR", side: "BUY", remainingQuantity: null, remainingNotionalSek: 150, availableAt: cutoffAt, ...extra });
const input = (extra: Partial<AccountLedgerV2Input> = {}): AccountLedgerV2Input => ({ accountId: "account", baselineAt: "2026-09-01T00:00:00.000Z", openingCashSek: 1000, openingCashStatus: "DECLARED", historyComplete: true, cutoffAt, dailyWindowStartAt: dayStart, fills: [], marks: [], pendingOrders: [], ...extra });

describe("account ledger v2 inventory and historical cost basis", () => {
  it("starts only from an explicit cash/zero-inventory boundary", () => {
    const result = rebuildAccountLedgerV2(input());
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 1000, realizedPnlSek: 0, dailyRealizedPnlSek: 0, feesSek: 0, grossExposureSek: 0, reservedBuySek: 0, availableCashSek: 1000, openPositions: 0, positions: [] });
    for (const extra of [{ openingCashStatus: "UNKNOWN" as const }, { openingCashSek: null }, { baselineAt: null }, { historyComplete: false }]) {
      const unknown = rebuildAccountLedgerV2(input(extra));
      expect(unknown.status).toBe("UNKNOWN");
      expect(unknown.cashSek).toBeNull();
      expect(unknown.openPositions).toBeNull();
      expect(riskContextFromAccountLedgerV2(unknown).status).toBe("UNKNOWN");
    }
  });

  it("never mixes BTC and ETH quantity, basis, sale proceeds or current exposure", () => {
    const result = rebuildAccountLedgerV2(input({ openingCashSek: 10000, fills: [
      fill({ fillId: "btc-buy", quantity: 2, priceSek: 100, feeSek: 2 }),
      fill({ fillId: "eth-buy", instrumentId: "ETH-EUR", quantity: 3, priceSek: 200, feeSek: 3 }),
      fill({ fillId: "btc-sell", side: "SELL", quantity: 1, priceSek: 130, feeSek: 1, occurredAt: today, availableAt: today }),
      fill({ fillId: "eth-sell", instrumentId: "ETH-EUR", side: "SELL", quantity: 1, priceSek: 150, feeSek: 1, occurredAt: today, availableAt: today }),
    ], marks: [mark("BTC-EUR", 140), mark("ETH-EUR", 160)] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 9473, realizedPnlSek: -24, dailyRealizedPnlSek: -24, feesSek: 7, grossFeesSek: 7, rebatesSek: 0, grossExposureSek: 460, openPositions: 2 });
    expect(result.positions).toMatchObject([
      { instrumentId: "BTC-EUR", quantity: 1, costBasisSek: 101, averageCostSek: 101, realizedPnlSek: 28, marketValueSek: 140 },
      { instrumentId: "ETH-EUR", quantity: 2, costBasisSek: 402, averageCostSek: 201, realizedPnlSek: -52, marketValueSek: 320 },
    ]);
    expect(result).not.toHaveProperty("openQuantity");
    expect(result).not.toHaveProperty("averageCostSek");
  });

  it("uses prior-day buys for today's sale but only today's realized PnL for the loss guard", () => {
    const priorExit = "2026-09-06T11:00:00.000Z";
    const result = rebuildAccountLedgerV2(input({ fills: [
      fill({ fillId: "buy", quantity: 2, feeSek: 2 }),
      fill({ fillId: "old-sell", side: "SELL", priceSek: 150, feeSek: 1, occurredAt: priorExit, availableAt: priorExit }),
      fill({ fillId: "today-sell", side: "SELL", priceSek: 90, feeSek: 1, occurredAt: today, availableAt: today }),
    ] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 1036, realizedPnlSek: 36, dailyRealizedPnlSek: -12, dailyFeesSek: 1, openPositions: 0, grossExposureSek: 0 });
    expect(result.positions[0]).toMatchObject({ quantity: 0, costBasisSek: 0, averageCostSek: 0 });
    expect(riskContextFromAccountLedgerV2(result)).toMatchObject({ status: "KNOWN", dailyLossSek: 12, totalExposureSek: 0, availableCashSek: 1036 });
  });

  it("cannot sell ETH against BTC inventory or count another account's fills", () => {
    for (const problem of [fill({ fillId: "eth-sell", instrumentId: "ETH-EUR", side: "SELL", occurredAt: today, availableAt: today }), fill({ fillId: "foreign", accountId: "other" })]) {
      const result = rebuildAccountLedgerV2(input({ fills: [fill(), problem], marks: [mark()] }));
      expect(result.status).toBe("UNKNOWN");
      expect(result.cashSek).toBeNull();
      expect(result.realizedPnlSek).toBeNull();
      expect(result.grossExposureSek).toBeNull();
    }
  });

  it("handles representational dust on a full sale without permitting material oversells", () => {
    const second = "2026-09-06T10:01:00.000Z";
    const result = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 0.1 }), fill({ fillId: "buy-2", quantity: 0.2, occurredAt: second, availableAt: second }), fill({ fillId: "sell", side: "SELL", quantity: 0.3, occurredAt: today, availableAt: today })] }));
    expect(result.status).toBe("KNOWN");
    expect(result.openPositions).toBe(0);
    const oversell = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 0.1 }), fill({ fillId: "sell", side: "SELL", quantity: 0.1001, occurredAt: today, availableAt: today })] }));
    expect(oversell.status).toBe("UNKNOWN");
  });
});

describe("signed quote and base fees", () => {
  it("capitalizes a quote buy fee and accounts for a quote sell rebate exactly once", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 10, priceSek: 10, feeSek: 2 }), fill({ fillId: "sell", side: "SELL", quantity: 4, priceSek: 20, feeSek: -1, occurredAt: today, availableAt: today })], marks: [mark("BTC-EUR", 20)] }));
    expect(result.status).toBe("KNOWN");
    expect(result.cashSek).toBe(979);
    expect(result.realizedPnlSek).toBeCloseTo(40.2);
    expect(result).toMatchObject({ feesSek: 1, grossFeesSek: 2, rebatesSek: 1 });
    expect(result.positions[0].costBasisSek).toBeCloseTo(61.2);
  });

  it("a BASE buy fee reduces acquired inventory, not cash a second time", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 10, priceSek: 10, feeAsset: "BASE", feeBaseQuantity: 1, feeSek: 10 })], marks: [mark("BTC-EUR", 15)] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 900, feesSek: 10, grossFeesSek: 10, grossExposureSek: 135 });
    expect(result.positions[0]).toMatchObject({ quantity: 9, costBasisSek: 100 });
    expect(result.positions[0].averageCostSek).toBeCloseTo(100 / 9);
  });

  it("a BASE sell fee consumes additional inventory and basis, without another cash fee", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [
      fill({ quantity: 10, priceSek: 10, feeAsset: "BASE", feeBaseQuantity: 1, feeSek: 10 }),
      fill({ fillId: "sell", side: "SELL", quantity: 4, priceSek: 20, feeAsset: "BASE", feeBaseQuantity: 0.2, feeSek: 4, occurredAt: today, availableAt: today }),
    ], marks: [mark("BTC-EUR", 15)] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 980, feesSek: 14, grossFeesSek: 14 });
    expect(result.positions[0].quantity).toBeCloseTo(4.8);
    expect(result.positions[0].costBasisSek).toBeCloseTo(100 / 9 * 4.8);
    expect(result.realizedPnlSek).toBeCloseTo(80 - 100 / 9 * 4.2);
  });

  it("BASE rebates add/retain inventory and retain the signed fee convention", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [
      fill({ quantity: 10, priceSek: 10, feeAsset: "BASE", feeBaseQuantity: -1, feeSek: -10 }),
      fill({ fillId: "sell", side: "SELL", quantity: 4, priceSek: 20, feeAsset: "BASE", feeBaseQuantity: -0.2, feeSek: -4, occurredAt: today, availableAt: today }),
    ], marks: [mark("BTC-EUR", 15)] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 980, feesSek: -14, grossFeesSek: 0, rebatesSek: 14 });
    expect(result.positions[0].quantity).toBeCloseTo(7.2);
    expect(result.realizedPnlSek).toBeCloseTo(80 - 100 / 11 * 3.8);
  });

  it("fails closed when a base-fee sell needs more units than the position", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill(), fill({ fillId: "sell", side: "SELL", feeAsset: "BASE", feeBaseQuantity: 0.01, feeSek: 1, occurredAt: today, availableAt: today })] }));
    expect(result.unknownReasons).toContain("SELL_EXCEEDS_POSITION:sell");
    expect(result.realizedPnlSek).toBeNull();
  });

  it.each([
    { feeAsset: "UNKNOWN" as const },
    { feeAsset: "BASE" as const, feeBaseQuantity: null, feeSek: 1 },
    { feeAsset: "BASE" as const, feeBaseQuantity: 0.01, feeSek: -1 },
    { feeAsset: "BASE" as const, feeBaseQuantity: 1, feeSek: 100 },
    { feeAsset: "QUOTE" as const, feeBaseQuantity: 0.01, feeSek: 1 },
  ])("blocks unknown/conflicting/net-invalid fee data: %j", extra => {
    expect(rebuildAccountLedgerV2(input({ fills: [fill(extra)], marks: [mark()] })).status).toBe("UNKNOWN");
  });
});

describe("remaining order reservations and current marks", () => {
  it("reserves only remaining buy notional, not its original order size or pending sells", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 2 })], marks: [mark()], pendingOrders: [pending({ remainingNotionalSek: 35 }), pending({ orderId: "sell", side: "SELL", remainingQuantity: 0.5, remainingNotionalSek: 5000 })] }));
    expect(result).toMatchObject({ status: "KNOWN", cashSek: 800, reservedBuySek: 35, availableCashSek: 765, grossExposureSek: 300 });
    expect(result.positions[0]).toMatchObject({ reservedSellQuantity: 0.5, availableQuantity: 1.5 });
    expect(riskContextFromAccountLedgerV2(result)).toMatchObject({ totalExposureSek: 335, availableSellQuantity: { "BTC-EUR": 1.5 } });
  });

  it("excludes the current queued BUY reservation without excluding any executed fills", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill()], marks: [mark("BTC-EUR", 120)], pendingOrders: [pending({ orderId: "self", remainingNotionalSek: 300 }), pending({ orderId: "other", remainingNotionalSek: 150 })] }));
    expect(result).toMatchObject({ cashSek: 900, reservedBuySek: 450, availableCashSek: 450, grossExposureSek: 120 });
    expect(riskContextFromAccountLedgerV2(result, "self")).toMatchObject({ status: "KNOWN", totalExposureSek: 270, availableCashSek: 750 });
    expect(result.reservedBuySek).toBe(450);
    const preExcluded = rebuildAccountLedgerV2(input({ fills: [fill()], marks: [mark()], pendingOrders: [pending({ orderId: "self", remainingNotionalSek: 300 }), pending({ orderId: "other", remainingNotionalSek: 150 })], excludeOrderId: "self" }));
    expect(preExcluded.reservedBuySek).toBe(150);
    expect(riskContextFromAccountLedgerV2(preExcluded).availableCashSek).toBe(750);
  });

  it("excludes just the current queued SELL quantity", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill({ quantity: 2 })], marks: [mark()], pendingOrders: [pending({ orderId: "self", side: "SELL", remainingQuantity: 1, remainingNotionalSek: null }), pending({ orderId: "other", side: "SELL", remainingQuantity: 0.5, remainingNotionalSek: null })] }));
    expect(result.positions[0].availableQuantity).toBe(0.5);
    expect(riskContextFromAccountLedgerV2(result, "self")).toMatchObject({ status: "KNOWN", availableCashSek: 800, totalExposureSek: 300, availableSellQuantity: { "BTC-EUR": 1.5 } });
  });

  it("over-reservation only resolves when excluding the responsible order, never by hiding missing marks", () => {
    const result = rebuildAccountLedgerV2(input({ pendingOrders: [pending({ orderId: "self", remainingNotionalSek: 900 }), pending({ orderId: "other", remainingNotionalSek: 300 })] }));
    expect(result.status).toBe("UNKNOWN");
    expect(riskContextFromAccountLedgerV2(result).status).toBe("UNKNOWN");
    expect(riskContextFromAccountLedgerV2(result, "self")).toMatchObject({ status: "KNOWN", availableCashSek: 700 });
    const missing = rebuildAccountLedgerV2(input({ fills: [fill()], pendingOrders: [pending({ orderId: "self", remainingNotionalSek: 1000 })] }));
    expect(riskContextFromAccountLedgerV2(missing, "self").status).toBe("UNKNOWN");
  });

  it("missing marks preserve known accounting but never fabricate current exposure from cost", () => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill()] }));
    expect(result).toMatchObject({ status: "UNKNOWN", cashSek: 900, realizedPnlSek: 0, grossExposureSek: null, openPositions: 1 });
    expect(result.positions[0]).toMatchObject({ quantity: 1, costBasisSek: 100, markPriceSek: null, marketValueSek: null });
    expect(riskContextFromAccountLedgerV2(result)).toMatchObject({ status: "UNKNOWN", totalExposureSek: null, availableCashSek: null });
  });

  it("uses latest point-in-time marks and blocks stale, future, duplicate and conflicting marks", () => {
    const fresh = rebuildAccountLedgerV2(input({ fills: [fill()], marks: [mark("BTC-EUR", 120, { observedAt: today, availableAt: today }), mark("BTC-EUR", 150)] }));
    expect(fresh).toMatchObject({ status: "KNOWN", grossExposureSek: 150 });
    for (const marks of [[mark("BTC-EUR", 100, { observedAt: today, availableAt: today })], [mark("BTC-EUR", NaN)], [mark("BTC-EUR", 100, { availableAt: "2026-09-07T12:01:00.000Z" })], [mark(), mark()], [mark(), mark("BTC-EUR", 160)]]) {
      const result = rebuildAccountLedgerV2(input({ fills: [fill()], marks }));
      expect(result.status).toBe("UNKNOWN");
      expect(result.grossExposureSek).toBeNull();
    }
  });

  it("rejects incomplete, foreign, duplicate or excessive sell reservations", () => {
    for (const orders of [null, [pending({ accountId: "other" })], [pending(), pending()], [pending(), pending({ remainingNotionalSek: 200 })], [pending({ remainingNotionalSek: NaN })], [pending({ side: "SELL", remainingQuantity: 2 })]]) {
      const result = rebuildAccountLedgerV2(input({ fills: [fill()], marks: [mark()], pendingOrders: orders }));
      expect(result.status).toBe("UNKNOWN");
      expect(riskContextFromAccountLedgerV2(result).status).toBe("UNKNOWN");
    }
  });
});

describe("fail-closed inputs, boundaries and reproducibility", () => {
  it.each([
    { quantity: NaN }, { quantity: Infinity }, { quantity: 0 }, { quantity: -1 },
    { priceSek: NaN }, { priceSek: null }, { priceSek: 0 }, { feeSek: null }, { feeSek: Infinity },
  ])("does not turn missing/nonfinite inputs into zero: %j", extra => {
    const result = rebuildAccountLedgerV2(input({ fills: [fill(extra)], marks: [mark()] }));
    expect(result.status).toBe("UNKNOWN");
    expect(result.cashSek).toBeNull();
    expect(result.realizedPnlSek).toBeNull();
    expect(result.feesSek).toBeNull();
  });

  it("blocks future fills by occurrence and knowledge time, not just one timestamp", () => {
    for (const extra of [{ occurredAt: "2026-09-07T12:01:00.000Z", availableAt: "2026-09-07T12:01:00.000Z" }, { availableAt: "2026-09-07T12:01:00.000Z" }, { occurredAt: "invalid" }, { availableAt: "2026-09-01T00:00:00.000Z" }]) {
      expect(rebuildAccountLedgerV2(input({ fills: [fill(extra)], marks: [mark()] })).status).toBe("UNKNOWN");
    }
  });

  it("keeps economic coverage separate from late-arriving knowledge", () => {
    const later = "2026-09-07T12:01:00.000Z";
    const options = input({ cutoffAt: later, economicCutoffAt: cutoffAt, fills: [fill({ occurredAt: today, availableAt: later })], marks: [mark("BTC-EUR", 150, { availableAt: later })] });
    expect(rebuildAccountLedgerV2(options)).toMatchObject({ status: "KNOWN", cutoffAt: later, economicCutoffAt: cutoffAt });
    expect(rebuildAccountLedgerV2({ ...options, fills: [fill({ occurredAt: "2026-09-07T12:00:30.000Z", availableAt: later })] }).status).toBe("UNKNOWN");
  });

  it("blocks duplicate/conflicting fill identity and ambiguous same-time buy/sell sequence", () => {
    for (const fills of [[fill(), fill()], [fill(), fill({ priceSek: 101 })], [fill(), fill({ fillId: "sell", side: "SELL" })]]) {
      const result = rebuildAccountLedgerV2(input({ fills, marks: [mark()] }));
      expect(result.status).toBe("UNKNOWN");
      expect(result.cashSek).toBeNull();
    }
  });

  it("never accepts an undeclared historical boundary or makes negative cash look funded", () => {
    for (const extra of [{ baselineAt: today, fills: [fill()] }, { baselineAt: "invalid" }, { baselineAt: "2026-09-08T00:00:00.000Z" }, { openingCashSek: NaN }, { dailyWindowStartAt: "2026-09-08T00:00:00.000Z" }, { fills: [fill({ quantity: 20 })] }]) {
      expect(rebuildAccountLedgerV2(input(extra)).status).toBe("UNKNOWN");
    }
  });

  it("propagates coverage/provider uncertainty inside the hashed result", () => {
    const healthy = rebuildAccountLedgerV2(input());
    const blocked = rebuildAccountLedgerV2(input({ externalUnknownReasons: ["FUNDING_COVERAGE_UNKNOWN"] }));
    expect(blocked).toMatchObject({ status: "UNKNOWN", unknownReasons: ["FUNDING_COVERAGE_UNKNOWN"] });
    expect(blocked.resultHash).not.toBe(healthy.resultHash);
    expect(riskContextFromAccountLedgerV2(blocked).status).toBe("UNKNOWN");
  });

  it("has deterministic instrument-separated hashes under input permutation", () => {
    const value = input({ fills: [fill(), fill({ fillId: "eth", instrumentId: "ETH-EUR", priceSek: 50 })], marks: [mark(), mark("ETH-EUR", 60)], pendingOrders: [pending(), pending({ orderId: "second", remainingNotionalSek: 100 })] });
    const first = rebuildAccountLedgerV2(value);
    const reversed = rebuildAccountLedgerV2({ ...value, fills: [...value.fills].reverse(), marks: [...value.marks].reverse(), pendingOrders: [...value.pendingOrders!].reverse() });
    expect(first.resultHash).toBe(reversed.resultHash);
    expect(first.inputHash).toBe(reversed.inputHash);
    expect(first.snapshotKey).toBe(reversed.snapshotKey);
    expect(rebuildAccountLedgerV2(input({ fills: [fill({ priceSek: NaN })] })).inputHash).not.toBe(rebuildAccountLedgerV2(input({ fills: [fill({ priceSek: null })] })).inputHash);
  });

  it("verifies persisted JSON payload identity and rejects old versions or changed cash", () => {
    const snapshot = rebuildAccountLedgerV2(input({ fills: [fill()], marks: [mark()], pendingOrders: [pending()] }));
    expect(verifyAccountLedgerV2Snapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
    for (const changed of [null, {}, { ...snapshot, version: "risk-ledger-v1" }, { ...snapshot, cashSek: 1000000 }, { ...snapshot, resultHash: "0".repeat(64) }, { ...snapshot, snapshotKey: "not-the-snapshot" }, { ...snapshot, cashSek: NaN }, { ...snapshot, positions: null }]) expect(verifyAccountLedgerV2Snapshot(changed)).toBe(false);
    expect(riskContextFromAccountLedgerV2({ ...snapshot, cashSek: 1000000 }).status).toBe("UNKNOWN");
  });
});
