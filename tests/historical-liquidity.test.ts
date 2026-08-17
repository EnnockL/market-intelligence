import { describe, expect, it } from "vitest";
import { classifyExecutionCapacity, selectPointInTimeLiquidity, type LiquiditySnapshot } from "../src/domain/historical-liquidity";
const row = (id: string, pool: string, liquidity: number, effectiveAt: string, availableAt = effectiveAt): LiquiditySnapshot => ({ id, assetId: "token", poolAddress: pool, liquidityUsd: liquidity, effectiveAt, informationAvailableAt: availableAt, provider: "test", quality: 100 });
describe("historical liquidity", () => {
  it("selects the latest eligible snapshot and highest-liquidity pool deterministically", () => { const rows = [row("b", "z", 100, "2026-01-01T00:00:00Z"), row("a", "a", 200, "2026-01-01T00:00:00Z")]; expect(selectPointInTimeLiquidity(rows, "token", "2026-01-02T00:00:00Z").snapshot?.poolAddress).toBe("a"); });
  it("ignores future effective and future-known snapshots", () => { const rows = [row("past", "p", 50, "2026-01-01T00:00:00Z"), row("future", "f", 1000, "2026-01-03T00:00:00Z"), row("late", "l", 900, "2026-01-01T00:00:00Z", "2026-01-04T00:00:00Z")]; expect(selectPointInTimeLiquidity(rows, "token", "2026-01-02T00:00:00Z").snapshot?.id).toBe("past"); });
  it("keeps missing historical liquidity null and capacity unknown", () => { expect(selectPointInTimeLiquidity([], "token", "2026-01-02T00:00:00Z").snapshot).toBeNull(); expect(classifyExecutionCapacity(100, null)).toEqual({ ratio: null, risk: "UNKNOWN" }); });
  it("classifies capacity by position/liquidity ratio", () => { expect(classifyExecutionCapacity(100, 100_000).risk).toBe("LOW"); expect(classifyExecutionCapacity(10_000, 100_000).risk).toBe("EXTREME"); });
});
