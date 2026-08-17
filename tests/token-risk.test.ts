import { describe, expect, it } from "vitest";
import { calculateRugExposure } from "../src/domain/token-risk";

describe("token risk exposure", () => {
  it("returns null rather than treating unassessed trades as safe", () => {
    expect(calculateRugExposure([{ assetId: "a", classification: null }])).toEqual({ rugExposureRate: null, assessedTrades: 0, exposedTrades: 0, coverage: 0 });
  });
  it("uses only assessed trades and reports coverage", () => {
    expect(calculateRugExposure([{ assetId: "a", classification: "rug_confirmed" }, { assetId: "b", classification: "clear" }, { assetId: "c", classification: null }]))
      .toEqual({ rugExposureRate: .5, assessedTrades: 2, exposedTrades: 1, coverage: 67 });
  });
});
