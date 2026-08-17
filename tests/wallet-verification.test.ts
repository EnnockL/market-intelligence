import { describe, expect, it } from "vitest";
import { buildVerificationProgress, calculateDataQualityV3, evaluateWalletVerification } from "../src/domain/wallet-verification";
const full = { verifiedTradeCycles: 20, overallDataQuality: 90, pricingCoverage: 95, liquidityCoverage: 90, riskCoverage: 90, historyDays: 40, drawdownAvailable: true };
describe("wallet verification policy", () => {
  it("keeps sparse evidence candidate and explains blockers", () => { const result = evaluateWalletVerification({ ...full, verifiedTradeCycles: 2, liquidityCoverage: 10 }); expect(result.eligibleStatus).toBe("candidate"); expect(result.failed.join(" ")).toContain("2/20"); });
  it("promotes meaningful partial history to reviewing", () => expect(evaluateWalletVerification({ ...full, verifiedTradeCycles: 7, liquidityCoverage: 40 }).eligibleStatus).toBe("reviewing"));
  it("makes complete evidence eligible for verified", () => expect(evaluateWalletVerification(full)).toMatchObject({ eligibleStatus: "verified", failed: [] }));
  it("keeps quality separate from performance", () => expect(calculateDataQualityV3({ transaction: 100, pricing: 100, liquidity: 0, fees: 100, priorityFees: 0, risk: 0, drawdownAvailable: false, tradeCycles: 100 })).toBe(55));
  it("reports exact remaining progress without changing policy", () => { const result = buildVerificationProgress({ ...full, verifiedTradeCycles: 7, historyDays: 19, liquidityCoverage: 72, riskCoverage: 84, overallDataQuality: 76 }); expect(result.items.find((item) => item.key === "verified_trades")).toMatchObject({ value: 7, required: 20, remaining: 13, passed: false }); expect(result.items.find((item) => item.key === "risk_coverage")).toMatchObject({ remaining: 0, passed: true }); });
});
