import { describe, expect, it } from "vitest";
import { calculateDataQualityV3, evaluateWalletVerification } from "../src/domain/wallet-verification";
const full = { verifiedTradeCycles: 20, overallDataQuality: 90, pricingCoverage: 95, liquidityCoverage: 90, riskCoverage: 90, historyDays: 40, drawdownAvailable: true };
describe("wallet verification policy", () => {
  it("keeps sparse evidence candidate and explains blockers", () => { const result = evaluateWalletVerification({ ...full, verifiedTradeCycles: 2, liquidityCoverage: 10 }); expect(result.eligibleStatus).toBe("candidate"); expect(result.failed.join(" ")).toContain("2/20"); });
  it("promotes meaningful partial history to reviewing", () => expect(evaluateWalletVerification({ ...full, verifiedTradeCycles: 7, liquidityCoverage: 40 }).eligibleStatus).toBe("reviewing"));
  it("makes complete evidence eligible for verified", () => expect(evaluateWalletVerification(full)).toMatchObject({ eligibleStatus: "verified", failed: [] }));
  it("keeps quality separate from performance", () => expect(calculateDataQualityV3({ transaction: 100, pricing: 100, liquidity: 0, fees: 100, priorityFees: 0, risk: 0, drawdownAvailable: false, tradeCycles: 100 })).toBe(55));
});
