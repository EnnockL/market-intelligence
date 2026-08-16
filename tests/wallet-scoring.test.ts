import { describe, expect, it } from "vitest";
import { calculateWalletScore } from "../src/domain/wallet-scoring";

describe("calculateWalletScore", () => {
  it("returns a versioned, reproducible component breakdown", () => {
    const result = calculateWalletScore({ tradeCount: 428, winRate: 0.67, medianReturn: 0.38, realizedPnl30d: 183000, rugExposureRate: 0.04, maxDrawdown: 0.18, profitableMonths: 8, trackedMonths: 10 });
    expect(result.version).toBe("wallet-v1");
    expect(result.dataQuality).toBe(100);
    expect(result.score).toBe(67);
    expect(result.components).toHaveLength(6);
    expect(result.components.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
  });

  it("penalizes small samples without changing component inputs", () => {
    const base = { winRate: 0.8, medianReturn: 0.5, realizedPnl30d: 50000, rugExposureRate: 0, maxDrawdown: 0.1, profitableMonths: 3, trackedMonths: 3 };
    const small = calculateWalletScore({ ...base, tradeCount: 5 });
    const mature = calculateWalletScore({ ...base, tradeCount: 150 });
    expect(small.score).toBeLessThan(mature.score);
    expect(small.dataQuality).toBe(5);
  });

  it("handles an empty history safely", () => {
    const result = calculateWalletScore({ tradeCount: 0, winRate: 0, medianReturn: 0, realizedPnl30d: 0, rugExposureRate: 0, maxDrawdown: 0, profitableMonths: 0, trackedMonths: 0 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});
