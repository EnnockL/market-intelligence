import { describe, expect, it } from "vitest";
import { calculateRugExposure, selectRiskAt } from "../src/domain/token-risk";

describe("token risk exposure", () => {
  it("returns null rather than treating unassessed trades as safe", () => {
    expect(calculateRugExposure([{ assetId: "a", classification: null }])).toEqual({ rugExposureRate: null, assessedTrades: 0, exposedTrades: 0, coverage: 0 });
  });
  it("ignores a rug classification that became known after entry", () => {
    const records = [{ assetId: "a", status: "CONFIRMED_RUG" as const, score: 100, informationCutoffAt: "2026-01-03T00:00:00Z", informationAvailableAt: "2026-01-03T00:00:00Z", dataQuality: 100 }];
    expect(selectRiskAt(records, "a", "2026-01-02T00:00:00Z")).toBeNull();
    expect(selectRiskAt(records, "a", "2026-01-04T00:00:00Z")?.status).toBe("CONFIRMED_RUG");
  });
  it("uses only assessed trades and reports coverage", () => {
    expect(calculateRugExposure([{ assetId: "a", classification: "rug_confirmed" }, { assetId: "b", classification: "clear" }, { assetId: "c", classification: null }]))
      .toEqual({ rugExposureRate: .5, assessedTrades: 2, exposedTrades: 1, coverage: 67 });
  });
});
