import { describe, expect, it } from "vitest";
import { classifyMarketRegime, type RegimeObservationPair } from "../src/domain/market-regime";

const now = "2026-08-24T12:00:00.000Z";
function row(index: number, changePct: number, currentObservedAt = now): RegimeObservationPair {
  return { assetId: `asset-${index}`, baselinePrice: 100, currentPrice: 100 * (1 + changePct / 100), baselineObservedAt: "2026-08-23T12:00:00.000Z", currentObservedAt, evidenceRefs: [`old-${index}`, `new-${index}`] };
}

describe("market regime v1", () => {
  it("detects broad crypto risk-on", () => {
    const result = classifyMarketRegime({ assetClass: "crypto", evaluatedAt: now, expectedAssets: 4, observations: [row(1, 4), row(2, 3), row(3, 2.5), row(4, -1)] });
    expect(result).toMatchObject({ regime: "RISK_ON", sampleSize: 4, positiveBreadthPct: 75 });
  });
  it("detects broad risk-off", () => {
    const result = classifyMarketRegime({ assetClass: "stock", evaluatedAt: now, expectedAssets: 3, observations: [row(1, -2), row(2, -1), row(3, -3)] });
    expect(result.regime).toBe("RISK_OFF");
  });
  it("detects sideways conditions", () => {
    const result = classifyMarketRegime({ assetClass: "stock", evaluatedAt: now, expectedAssets: 3, observations: [row(1, 0.1), row(2, -0.1), row(3, 0)] });
    expect(result.regime).toBe("SIDEWAYS");
  });
  it("returns unknown for insufficient coverage", () => {
    const result = classifyMarketRegime({ assetClass: "crypto", evaluatedAt: now, expectedAssets: 10, observations: [row(1, 5), row(2, 5)] });
    expect(result).toMatchObject({ regime: "UNKNOWN", reason: "MINIMUM_ASSET_SAMPLE_NOT_REACHED", confidence: null });
  });
  it("rejects stale inputs from the usable sample", () => {
    const stale = "2026-08-24T10:00:00.000Z";
    const result = classifyMarketRegime({ assetClass: "crypto", evaluatedAt: now, expectedAssets: 3, observations: [row(1, 5, stale), row(2, 5, stale), row(3, 5, stale)] });
    expect(result).toMatchObject({ regime: "UNKNOWN", sampleSize: 0 });
  });
  it("is deterministic", () => {
    const input = { assetClass: "stock" as const, evaluatedAt: now, expectedAssets: 3, observations: [row(3, 1), row(1, 1), row(2, 1)] };
    expect(classifyMarketRegime(input).resultHash).toBe(classifyMarketRegime(input).resultHash);
  });
});
