import { describe, expect, it } from "vitest";
import { calculateCompoundedMaxDrawdown, calculateWalletPnlMetrics, POSITION_ENGINE_VERSION,
  reconstructTradeCycles, type EnrichedWalletTrade } from "@/domain/wallet-pnl";
import { buildRealizedPnlCurve } from "@/domain/wallet-performance";

function batch(exitOverrides: Partial<EnrichedWalletTrade> = {}) {
  return Array.from({ length: 201 }, (_, index): EnrichedWalletTrade => ({
    id: String(index), signature: `signature-${index}`, instructionIndex: 0, token: "fixture",
    side: index === 200 ? "sell" : "buy", quantity: index === 200 ? 200 : 1,
    occurredAt: new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString(),
    tokenPriceUsd: index === 200 ? 2 : 1, feeUsd: 0, pricingComplete: true,
    executionComplete: true, informationCompleteness: 100,
    ...(index === 200 ? exitOverrides : {}),
  }));
}

describe("wallet PnL exact evidence integrity", () => {
  it("does not verify 200 complete buys followed by an exit with unknown information", () => {
    const cycles = reconstructTradeCycles(batch({ informationCompleteness: 0 }));
    expect(cycles[0]).toMatchObject({ informationCompleteness: 100, allRequiredEvidencePresent: false,
      dataQuality: 99, status: "incomplete", realizedPnlUsd: 200, engineVersion: "weighted-average-v2" });
    expect(calculateWalletPnlMetrics(cycles)).toMatchObject({ closedTrades: 1, verifiedTrades: 0, winRate: null, realizedPnlUsd: null });
    expect(calculateCompoundedMaxDrawdown(cycles)).toBeNull();
    expect(buildRealizedPnlCurve(cycles)).toEqual([]);
  });

  it.each([
    { informationCompleteness: 99.9 }, { informationCompleteness: 101 },
    { informationCompleteness: Number.NaN }, { informationCompleteness: Number.POSITIVE_INFINITY },
    { pricingComplete: false }, { executionComplete: false },
    { tokenPriceUsd: null }, { tokenPriceUsd: 0 }, { tokenPriceUsd: -1 },
    { tokenPriceUsd: Number.NaN }, { tokenPriceUsd: Number.POSITIVE_INFINITY },
    { feeUsd: null }, { feeUsd: -1 }, { feeUsd: Number.NaN }, { feeUsd: Number.POSITIVE_INFINITY },
  ])("keeps every missing/invalid required exit field out of verified results: %o", (overrides) => {
    const cycles = reconstructTradeCycles(batch(overrides));
    expect(cycles[0].allRequiredEvidencePresent).toBe(false);
    expect(cycles[0].dataQuality).toBeLessThan(100);
    expect(calculateWalletPnlMetrics(cycles).verifiedTrades).toBe(0);
    expect(buildRealizedPnlCurve(cycles)).toEqual([]);
  });

  it("does not round away an invalid event among otherwise valid events", () => {
    const trades = batch();
    trades.splice(100, 0, { ...trades[100], id: "invalid", signature: "invalid", quantity: 0 });
    const cycles = reconstructTradeCycles(trades);
    expect(cycles[0]).toMatchObject({ transactionCompleteness: 100, allRequiredEvidencePresent: false, dataQuality: 99, status: "incomplete" });
    expect(calculateWalletPnlMetrics(cycles).verifiedTrades).toBe(0);
  });

  it("accepts genuinely complete events, including a known zero fee, without lower thresholds", () => {
    const cycles = reconstructTradeCycles(batch());
    expect(cycles[0]).toMatchObject({ allRequiredEvidencePresent: true, dataQuality: 100, status: "closed", realizedPnlUsd: 200 });
    expect(calculateWalletPnlMetrics(cycles).verifiedTrades).toBe(1);
    expect(buildRealizedPnlCurve(cycles)).toHaveLength(1);
    expect(POSITION_ENGINE_VERSION).toBe("weighted-average-v2");
  });

  it("requires the exact predicate even if a rounded legacy score claims 100", () => {
    const [complete] = reconstructTradeCycles(batch());
    const legacy = { ...complete, allRequiredEvidencePresent: undefined } as unknown as typeof complete;
    expect(calculateWalletPnlMetrics([legacy]).verifiedTrades).toBe(0);
    expect(calculateCompoundedMaxDrawdown([legacy])).toBeNull();
    expect(legacy.dataQuality).toBe(100);
  });
});
