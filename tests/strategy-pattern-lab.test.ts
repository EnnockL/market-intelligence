import { describe, expect, it } from "vitest";
import { ASIA_NY_SWEEP_REVERSAL_V1, aggregateTrades, evaluateStrategy, type StrategyTrade } from "../src/domain/strategy-pattern-lab";
import type { MarketCandle } from "../src/domain/technical-structure";

const candle = (id: string, openedAt: string, open: number, high: number, low: number, close: number): MarketCandle => ({ id, assetId: "xau", timeframe: "5m", openedAt, closedAt: new Date(Date.parse(openedAt) + 300_000).toISOString(), availableAt: new Date(Date.parse(openedAt) + 300_000).toISOString(), open, high, low, close, volume: 100 });
const data = [
  candle("ny-1", "2026-08-23T12:00:00.000Z", 100, 110, 90, 105),
  candle("ny-2", "2026-08-23T12:05:00.000Z", 105, 109, 91, 100),
  candle("asia-sweep", "2026-08-24T00:00:00.000Z", 108, 112, 106, 109),
  candle("asia-target", "2026-08-24T00:05:00.000Z", 109, 109, 89, 90),
];

describe("strategy pattern lab v1", () => {
  it("replays a New York high sweep reversal deterministically", () => {
    const definition = { ...ASIA_NY_SWEEP_REVERSAL_V1, minimumSampleSize: 1 };
    const first = evaluateStrategy(definition, data, "2026-08-24T01:00:00.000Z");
    const second = evaluateStrategy(definition, [...data].reverse(), "2026-08-24T01:00:00.000Z");
    expect(first.status).toBe("AVAILABLE");
    expect(first.trades).toHaveLength(1);
    expect(first.trades[0].side).toBe("SHORT");
    expect(first.trades[0].outcome).toBe("WIN");
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.trades).toEqual(second.trades);
  });
  it("does not expose win rates below the sample threshold", () => {
    const trade = evaluateStrategy({ ...ASIA_NY_SWEEP_REVERSAL_V1, minimumSampleSize: 1 }, data, "2026-08-24T01:00:00.000Z").trades[0];
    const result = aggregateTrades([trade], 30);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.metrics.winRate).toBeNull();
  });
  it("does not consume future candles", () => {
    const future = candle("future", "2026-08-25T00:00:00.000Z", 1, 999, 0, 1);
    const result = evaluateStrategy({ ...ASIA_NY_SWEEP_REVERSAL_V1, minimumSampleSize: 1 }, [...data, future], "2026-08-24T01:00:00.000Z");
    expect(result.trades.flatMap(item => item.evidenceRefs)).not.toContain("future");
  });
  it("computes drawdown, MFE and MAE from immutable trade outcomes", () => {
    const base: StrategyTrade = { tradeKey: "1", side: "LONG", setupAt: "2026-01-01T00:00:00Z", enteredAt: "2026-01-01T00:00:00Z", exitedAt: "2026-01-01T01:00:00Z", entry: 1, stop: 0, target: 2, exit: 2, outcome: "WIN", rMultiple: 1, mfeR: 1.2, maeR: -0.2, holdMinutes: 60, evidenceRefs: [], session: "ASIA", weekday: "Monday", regime: "UNKNOWN" };
    const result = aggregateTrades([base, { ...base, tradeKey: "2", rMultiple: -1, outcome: "LOSS" }], 2);
    expect(result.metrics.maxDrawdownR).toBe(-1);
    expect(result.metrics.averageMfeR).toBe(1.2);
  });
});
