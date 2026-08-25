import { describe, expect, it } from "vitest";
import { calculateWalletScoreV3 } from "../src/domain/wallet-scoring";
const strong = { verifiedTrades: 30, winRate: .75, medianReturn: 20, realizedPnlUsd: 50_000, maxDrawdown: .1, rugExposureRate: 0, entryQuality: 85, executionQuality: 90, overallDataQuality: 95 };
describe("wallet score v3", () => {
  it("penalizes a single jackpot trade", () => expect(calculateWalletScoreV3({ ...strong, verifiedTrades: 1 }).score).toBeLessThan(30));
  it("rewards many consistent verified trades", () => expect(calculateWalletScoreV3(strong).score).toBeGreaterThan(75));
  it("penalizes severe drawdown and rug exposure", () => expect(calculateWalletScoreV3({ ...strong, maxDrawdown: .8, rugExposureRate: .6 }).score).toBeLessThan(calculateWalletScoreV3(strong).score));
  it("cannot hide excellent performance behind poor evidence", () => expect(calculateWalletScoreV3({ ...strong, overallDataQuality: 10, liquidityCoverage: 0 } as never).dataQuality).toBe(10));
});
