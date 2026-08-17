import { describe, expect, it } from "vitest";
import { calculateCompoundedMaxDrawdown, calculateWalletPnlMetrics, reconstructTradeCycles, type EnrichedWalletTrade } from "../src/domain/wallet-pnl";

const at = (minute: number) => `2026-08-16T10:${String(minute).padStart(2, "0")}:00.000Z`;
function trade(id: string, side: "buy" | "sell", quantity: number, price: number | null, minute: number, fee = 0): EnrichedWalletTrade {
  return { id, signature: `sig-${id}`, instructionIndex: 0, token: "TOKEN", side, quantity, occurredAt: at(minute),
    tokenPriceUsd: price, feeUsd: price === null ? null : fee, pricingComplete: price !== null, executionComplete: price !== null, informationCompleteness: price === null ? 0 : 100 };
}

describe("weighted-average wallet position engine", () => {
  it("reconstructs buy to full sell with fees", () => {
    const [cycle] = reconstructTradeCycles([trade("1", "buy", 10, 2, 0, 1), trade("2", "sell", 10, 3, 10, 1)]);
    expect(cycle.status).toBe("closed"); expect(cycle.investedUsd).toBe(21); expect(cycle.proceedsUsd).toBe(29);
    expect(cycle.realizedPnlUsd).toBe(8); expect(cycle.returnPercent).toBeCloseTo(38.0952);
  });

  it("uses weighted average cost for multiple buys and a partial exit", () => {
    const cycles = reconstructTradeCycles([trade("1", "buy", 10, 1, 0), trade("2", "buy", 10, 3, 1), trade("3", "sell", 5, 4, 2)], 5);
    expect(cycles).toHaveLength(1); expect(cycles[0].quantity).toBe(15); expect(cycles[0].averageEntryUsd).toBe(2);
    expect(cycles[0].realizedPnlUsd).toBe(10); expect(cycles[0].costBasisUsd).toBe(30); expect(cycles[0].unrealizedPnlUsd).toBe(45);
  });

  it("creates a new cycle after full exit and re-entry", () => {
    const cycles = reconstructTradeCycles([trade("1", "buy", 2, 1, 0), trade("2", "sell", 2, 2, 1), trade("3", "buy", 3, 4, 2)]);
    expect(cycles).toHaveLength(2); expect(cycles[0].status).toBe("closed"); expect(cycles[1]).toMatchObject({ cycleNumber: 2, status: "open", quantity: 3 });
  });

  it("marks missing prices incomplete and excludes them from verified metrics", () => {
    const cycles = reconstructTradeCycles([trade("1", "buy", 2, null, 0), trade("2", "sell", 2, 2, 1)]);
    expect(cycles[0].status).toBe("incomplete"); expect(cycles[0].realizedPnlUsd).toBeNull();
    expect(calculateWalletPnlMetrics(cycles)).toMatchObject({ closedTrades: 1, verifiedTrades: 0, realizedPnlUsd: null, winRate: null });
  });

  it("deduplicates and sorts out-of-order input deterministically", () => {
    const buy = trade("1", "buy", 5, 2, 0); const sell = trade("2", "sell", 5, 3, 5);
    const first = reconstructTradeCycles([sell, buy, buy]); const second = reconstructTradeCycles([buy, sell]);
    expect(first).toEqual(second); expect(first[0].transactionIds).toEqual(["1", "2"]);
  });

  it("aggregates verified wallet metrics", () => {
    const cycles = reconstructTradeCycles([trade("1", "buy", 1, 10, 0), trade("2", "sell", 1, 12, 1), trade("3", "buy", 1, 10, 2), trade("4", "sell", 1, 8, 3)]);
    expect(calculateWalletPnlMetrics(cycles)).toMatchObject({ closedTrades: 2, verifiedTrades: 2, wins: 1, losses: 1, winRate: 0.5, medianReturn: 0 });
  });

  it("calculates deterministic compounded peak-to-trough drawdown", () => {
    const cycles = reconstructTradeCycles([trade("1", "buy", 1, 10, 0), trade("2", "sell", 1, 12, 1), trade("3", "buy", 1, 10, 2), trade("4", "sell", 1, 8, 3)]);
    expect(calculateCompoundedMaxDrawdown(cycles)).toBeCloseTo(.2);
  });
});
