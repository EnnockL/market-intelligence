import { describe, expect, it } from "vitest";
import { buildStrategyPerformanceSnapshot, selectStrategies, type StrategyResearchInput } from "../src/domain/strategy-intelligence";
import type { StrategyTrade } from "../src/domain/strategy-pattern-lab";

function trade(index: number, rMultiple = index % 3 === 0 ? -0.5 : 1): StrategyTrade {
  const enteredAt = new Date(Date.UTC(2026, 0, 1, 14, index * 5)).toISOString(), exitedAt = new Date(Date.parse(enteredAt) + 300_000).toISOString();
  return { tradeKey: `trade-${index}`, side: "LONG", setupAt: enteredAt, enteredAt, exitedAt, entry: 100, stop: 99, target: 102, exit: rMultiple > 0 ? 102 : 99, outcome: rMultiple > 0 ? "WIN" : "LOSS", rMultiple, mfeR: Math.max(0, rMultiple), maeR: Math.min(0, rMultiple), holdMinutes: 5, evidenceRefs: [`candle-${index}`], session: "NEW_YORK", weekday: "Monday", regime: "HIGH_VOLATILITY_MOMENTUM", entryHour: "09", volatilityBucket: "HIGH" };
}
function input(trades: StrategyTrade[], strategyId = "orb"): StrategyResearchInput { return { strategyId, strategyVersion: 1, evaluationRunId: `run-${strategyId}`, assetId: "btc", asset: "BTC", assetClass: "CRYPTO", market: "BTC-USD", timeframe: "5m", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-02T00:00:00.000Z", informationCutoffAt: "2026-01-02T00:00:00.000Z", session: "NEW_YORK", regime: "HIGH_VOLATILITY_MOMENTUM", split: "OUT_OF_SAMPLE", minimumSampleSize: 30, dataQuality: 90, trades }; }
const context = { assetId: "btc", asset: "BTC", assetClass: "CRYPTO", timeframe: "5m", session: "NEW_YORK", regime: "HIGH_VOLATILITY_MOMENTUM", volatilityBucket: "HIGH", liquidityBucket: "HIGH", cutoffAt: "2026-01-03T00:00:00.000Z", minimumSampleSize: 30 };

describe("strategy intelligence v1", () => {
  it("hides performance percentages below minimum sample size", () => {
    const snapshot = buildStrategyPerformanceSnapshot(input(Array.from({ length: 10 }, (_, index) => trade(index))));
    expect(snapshot.status).toBe("INSUFFICIENT_DATA");
    expect(snapshot.metrics.winRate).toBeNull();
  });

  it("produces immutable deterministic performance snapshots", () => {
    const trades = Array.from({ length: 30 }, (_, index) => trade(index));
    const first = buildStrategyPerformanceSnapshot(input(trades));
    const second = buildStrategyPerformanceSnapshot(input([...trades].reverse()));
    expect(first.snapshotKey).toBe(second.snapshotKey);
    expect(first.metrics.medianReturnR).not.toBeNull();
    expect(first.segments.some(item => item.dimension === "regime")).toBe(true);
  });

  it("ranks positive out-of-sample edge without using win rate alone", () => {
    const stable = buildStrategyPerformanceSnapshot(input(Array.from({ length: 40 }, (_, index) => trade(index)), "orb"));
    const weaker = buildStrategyPerformanceSnapshot(input(Array.from({ length: 40 }, (_, index) => trade(index, index % 2 ? 0.3 : -0.25)), "ema"));
    const result = selectStrategies(context, [weaker, stable]);
    expect(result.status).toBe("RANKED");
    expect(result.selectedStrategy?.strategyId).toBe("orb");
    expect(result.resultHash).toBe(selectStrategies(context, [stable, weaker]).resultHash);
  });

  it("returns NO_STRATEGY_ELIGIBLE for weak or missing evidence", () => {
    const losing = buildStrategyPerformanceSnapshot(input(Array.from({ length: 40 }, (_, index) => trade(index, -0.25)), "losing"));
    const result = selectStrategies(context, [losing]);
    expect(result.status).toBe("NO_STRATEGY_ELIGIBLE");
    expect(result.selectedStrategy).toBeNull();
  });

  it("does not use train snapshots or future snapshots as selection proof", () => {
    const train = buildStrategyPerformanceSnapshot({ ...input(Array.from({ length: 40 }, (_, index) => trade(index))), split: "TRAIN" });
    const future = buildStrategyPerformanceSnapshot({ ...input(Array.from({ length: 40 }, (_, index) => trade(index)), "future"), informationCutoffAt: "2026-01-04T00:00:00.000Z", windowEnd: "2026-01-04T00:00:00.000Z" });
    expect(selectStrategies(context, [train, future]).status).toBe("NO_STRATEGY_ELIGIBLE");
  });
});
