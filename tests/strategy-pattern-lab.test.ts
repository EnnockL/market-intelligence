import { describe, expect, it } from "vitest";
import { ASIA_NY_SWEEP_REVERSAL_V1, ORB_RETEST_15M_V1, ORB_RETEST_5M_V1, STRATEGY_RESEARCH_CATALOG, aggregateTrades, evaluateStrategy, type StrategyTrade } from "../src/domain/strategy-pattern-lab";
import type { MarketCandle } from "../src/domain/technical-structure";

const candle = (id: string, openedAt: string, open: number, high: number, low: number, close: number): MarketCandle => ({ id, assetId: "xau", timeframe: "5m", openedAt, closedAt: new Date(Date.parse(openedAt) + 300_000).toISOString(), availableAt: new Date(Date.parse(openedAt) + 300_000).toISOString(), open, high, low, close, volume: 100 });
const data = [
  candle("ny-1", "2026-08-23T12:00:00.000Z", 100, 110, 90, 105),
  candle("ny-2", "2026-08-23T12:05:00.000Z", 105, 109, 91, 100),
  candle("asia-sweep", "2026-08-24T00:00:00.000Z", 108, 112, 106, 109),
  candle("asia-target", "2026-08-24T00:05:00.000Z", 109, 109, 89, 90),
];

describe("strategy pattern lab v1", () => {
  it("registers ten unique unproven research candidates in deterministic priority order", () => {
    expect(STRATEGY_RESEARCH_CATALOG).toHaveLength(10);
    expect(new Set(STRATEGY_RESEARCH_CATALOG.map(item => item.definition.strategyId)).size).toBe(10);
    expect(STRATEGY_RESEARCH_CATALOG.map(item => item.researchPriority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(STRATEGY_RESEARCH_CATALOG.every(item => item.researchStatus === "UNPROVEN")).toBe(true);
  });
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
    const base: StrategyTrade = { tradeKey: "1", side: "LONG", setupAt: "2026-01-01T00:00:00Z", enteredAt: "2026-01-01T00:00:00Z", exitedAt: "2026-01-01T01:00:00Z", entry: 1, stop: 0, target: 2, exit: 2, outcome: "WIN", rMultiple: 1, mfeR: 1.2, maeR: -0.2, holdMinutes: 60, evidenceRefs: [], session: "ASIA", weekday: "Monday", regime: "UNKNOWN", entryHour: "09", volatilityBucket: "UNKNOWN" };
    const result = aggregateTrades([base, { ...base, tradeKey: "2", rMultiple: -1, outcome: "LOSS" }], 2);
    expect(result.metrics.maxDrawdownR).toBe(-1);
    expect(result.metrics.averageMfeR).toBe(1.2);
  });
});

describe("opening range breakout v1", () => {
  const orbCandles = [
    candle("range-1", "2026-08-24T13:30:00.000Z", 100, 101, 99, 100),
    candle("range-2", "2026-08-24T13:35:00.000Z", 100, 102, 100, 101),
    candle("range-3", "2026-08-24T13:40:00.000Z", 101, 101.5, 100, 101),
    { ...candle("breakout", "2026-08-24T13:45:00.000Z", 101, 103, 101, 102.5), volume: 200 },
    { ...candle("retest", "2026-08-24T13:50:00.000Z", 102.5, 102.6, 101.9, 102.2), volume: 150 },
    { ...candle("target", "2026-08-24T13:55:00.000Z", 102.2, 103.2, 102, 103), volume: 160 },
  ];

  it("waits for a confirmed breakout and retest before entering", () => {
    const result = evaluateStrategy({ ...ORB_RETEST_15M_V1, minimumSampleSize: 1 }, orbCandles, "2026-08-24T15:00:00.000Z");
    expect(result.setupCount).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "LONG", outcome: "WIN", setupAt: orbCandles[3].closedAt, enteredAt: orbCandles[4].closedAt, entryHour: "09" });
    expect(result.trades[0].evidenceRefs).toContain("range-1");
  });

  it("records a setup but no trade when the retest never occurs", () => {
    const withoutRetest = [orbCandles[0], orbCandles[1], orbCandles[2], orbCandles[3], { ...orbCandles[4], id: "continuation", low: 102.3, close: 102.5 }];
    const result = evaluateStrategy({ ...ORB_RETEST_15M_V1, minimumSampleSize: 1 }, withoutRetest, "2026-08-24T15:00:00.000Z");
    expect(result.setupCount).toBe(1);
    expect(result.tradeCount).toBe(0);
  });

  it("keeps 5-minute and 15-minute definitions independently reproducible", () => {
    const five = evaluateStrategy({ ...ORB_RETEST_5M_V1, minimumSampleSize: 1 }, orbCandles, "2026-08-24T15:00:00.000Z");
    const fifteen = evaluateStrategy({ ...ORB_RETEST_15M_V1, minimumSampleSize: 1 }, orbCandles, "2026-08-24T15:00:00.000Z");
    expect(five.inputHash).not.toBe(fifteen.inputHash);
    expect(fifteen.inputHash).toBe(evaluateStrategy({ ...ORB_RETEST_15M_V1, minimumSampleSize: 1 }, [...orbCandles].reverse(), "2026-08-24T15:00:00.000Z").inputHash);
  });

  it("rejects candles that were not available at the replay cutoff", () => {
    const unavailableTarget = { ...orbCandles[5], availableAt: "2026-08-25T00:00:00.000Z" };
    const result = evaluateStrategy({ ...ORB_RETEST_15M_V1, minimumSampleSize: 1 }, [...orbCandles.slice(0, 5), unavailableTarget], "2026-08-24T15:00:00.000Z");
    expect(result.trades[0].evidenceRefs).not.toContain("target");
    expect(result.candleCount).toBe(5);
  });
});
