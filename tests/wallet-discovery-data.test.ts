import { describe, expect, it } from "vitest";
import { mapWalletCandidate } from "../src/data/wallet-discovery-data";

describe("wallet discovery dashboard mapping", () => {
  it("normalizes numeric database values and sanitizes arrays", () => {
    const result = mapWalletCandidate({ address: "FzDEnvLBbDSuPpuY6YhQismrgLB4DZs8DoLBti7wfLku", status: "candidate", score: 56,
      data_quality: 83, observed_transactions: 20, successful_transactions: 20, active_days: "3.0989",
      risk_flags: ["profitability_unverified", 123], reasons: ["20 recent transactions sampled"], last_observed_at: "2026-08-16T21:01:37.598Z" });
    expect(result.activeDays).toBeCloseTo(3.0989);
    expect(result.riskFlags).toEqual(["profitability_unverified"]);
    expect(result.score).toBe(56);
  });
});
