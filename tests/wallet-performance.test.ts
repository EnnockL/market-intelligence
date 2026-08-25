import { describe, expect, it } from "vitest";
import { calculateDrawdown, type PerformancePoint } from "../src/domain/wallet-performance";
const p = (day: number, equity: number, pnl = equity - 1): PerformancePoint => ({ timestamp: `2026-01-0${day}T00:00:00Z`, tradeCycleId: String(day), cumulativeRealizedPnlUsd: pnl, cumulativeReturn: equity - 1, equityIndex: equity });
describe("wallet drawdown", () => {
  it("reports insufficient data", () => expect(calculateDrawdown([p(1, 1)])).toMatchObject({ status: "insufficient_data", maxDrawdownPercent: null }));
  it("reports no drawdown for monotonic growth", () => expect(calculateDrawdown([p(1, 1), p(2, 1.1), p(3, 1.2)]).maxDrawdownPercent).toBe(0));
  it("finds simple unrecovered drawdown", () => { const result = calculateDrawdown([p(1, 1), p(2, 1.2, 20), p(3, .9, -10)]); expect(result.maxDrawdownPercent).toBeCloseTo(.25); expect(result.recoveredAt).toBeNull(); });
  it("finds recovery timestamp", () => expect(calculateDrawdown([p(1, 1), p(2, 1.2), p(3, .9), p(4, 1.25)]).recoveredAt).toBe("2026-01-04T00:00:00Z"));
  it("measures an early loss against the implicit 1.0 starting index", () => expect(calculateDrawdown([p(1, .8, -20), p(2, .9, -10)]).maxDrawdownPercent).toBeCloseTo(.2));
});
