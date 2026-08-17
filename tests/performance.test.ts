import { describe, it, expect } from "vitest";
import { calculatePerformance } from "@/domain/performance";
const empty = {
  initialCash: 20_000,
  currentCash: 20_000,
  evaluations: [
    { candidateId: "a", status: "REJECTED", reason: "CANDIDATE_NOT_QUALIFIED" },
  ],
  orders: [],
  positions: [],
  equityPoints: [{ at: "2026-01-01T00:00:00Z", equity: 20_000 }],
};
describe("performance agent v1", () => {
  it("measures pre-trade funnel and blockers", () => {
    const r = calculatePerformance(empty);
    expect(r.funnel).toEqual({
      observed: 1,
      evaluated: 1,
      eligible: 0,
      ordered: 0,
      filled: 0,
      closed: 0,
    });
    expect(r.rejectReasons).toEqual({ CANDIDATE_NOT_QUALIFIED: 1 });
    expect(r.rates.reject).toBe(100);
  });
  it("returns insufficient data rather than zero trading metrics", () => {
    const m = calculatePerformance(empty).metrics;
    expect(m.winRate).toMatchObject({
      status: "INSUFFICIENT_DATA",
      value: null,
    });
    expect(m.profitFactor).toMatchObject({ status: "INSUFFICIENT_DATA" });
    expect(m.maxDrawdown).toMatchObject({ status: "INSUFFICIENT_DATA" });
  });
  it("calculates closed-trade metrics and drawdown", () => {
    const r = calculatePerformance({
      ...empty,
      evaluations: [],
      positions: [
        {
          openedAt: "2026-01-01T00:00:00Z",
          closedAt: "2026-01-02T00:00:00Z",
          realizedPnl: 100,
          unrealizedPnl: 0,
          marketValue: 0,
          costBasis: 0,
        },
        {
          openedAt: "2026-01-01T00:00:00Z",
          closedAt: "2026-01-01T12:00:00Z",
          realizedPnl: -50,
          unrealizedPnl: 0,
          marketValue: 0,
          costBasis: 0,
        },
      ],
      equityPoints: [
        { at: "2026-01-01T00:00:00Z", equity: 1000 },
        { at: "2026-01-02T00:00:00Z", equity: 800 },
      ],
    });
    expect(r.metrics.winRate).toMatchObject({ value: 50 });
    expect(r.metrics.profitFactor).toMatchObject({ value: 2 });
    expect(r.metrics.maxDrawdown).toMatchObject({ value: 20 });
  });
  it("is deterministic", () =>
    expect(calculatePerformance(empty)).toEqual(calculatePerformance(empty)));
});
