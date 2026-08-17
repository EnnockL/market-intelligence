export const WALLET_VERIFICATION_POLICY = { version: "wallet-verification-policy-v1", minimumVerifiedTradeCycles: 20, minimumOverallDataQuality: 80, minimumPricingCoverage: 90, minimumLiquidityCoverage: 80, minimumRiskCoverage: 80, minimumHistoryDays: 30 } as const;
export type WalletLifecycle = "candidate" | "reviewing" | "verified";
export interface VerificationInput { verifiedTradeCycles: number; overallDataQuality: number; pricingCoverage: number; liquidityCoverage: number; riskCoverage: number; historyDays: number; drawdownAvailable: boolean; }
export interface VerificationEvaluation { policyVersion: string; eligibleStatus: WalletLifecycle; passed: string[]; failed: string[]; }

export function evaluateWalletVerification(input: VerificationInput): VerificationEvaluation {
  const checks: Array<[string, boolean, string]> = [
    ["verified_trades", input.verifiedTradeCycles >= WALLET_VERIFICATION_POLICY.minimumVerifiedTradeCycles, `Only ${input.verifiedTradeCycles}/${WALLET_VERIFICATION_POLICY.minimumVerifiedTradeCycles} required verified trades`],
    ["overall_data_quality", input.overallDataQuality >= WALLET_VERIFICATION_POLICY.minimumOverallDataQuality, `Overall data quality: ${input.overallDataQuality}%/${WALLET_VERIFICATION_POLICY.minimumOverallDataQuality}%`],
    ["historical_pricing", input.pricingCoverage >= WALLET_VERIFICATION_POLICY.minimumPricingCoverage, `Historical pricing coverage: ${input.pricingCoverage}%/${WALLET_VERIFICATION_POLICY.minimumPricingCoverage}%`],
    ["historical_liquidity", input.liquidityCoverage >= WALLET_VERIFICATION_POLICY.minimumLiquidityCoverage, `Historical liquidity coverage: ${input.liquidityCoverage}%/${WALLET_VERIFICATION_POLICY.minimumLiquidityCoverage}%`],
    ["rug_risk", input.riskCoverage >= WALLET_VERIFICATION_POLICY.minimumRiskCoverage, `Rug exposure coverage: ${input.riskCoverage}%/${WALLET_VERIFICATION_POLICY.minimumRiskCoverage}%`],
    ["history", input.historyDays >= WALLET_VERIFICATION_POLICY.minimumHistoryDays, `History: ${input.historyDays}/${WALLET_VERIFICATION_POLICY.minimumHistoryDays} days`],
    ["drawdown", input.drawdownAvailable, "Drawdown unavailable: insufficient verified performance points"],
  ];
  const passed = checks.filter(([, ok]) => ok).map(([name]) => name); const failed = checks.filter(([, ok]) => !ok).map(([, , reason]) => reason);
  const eligibleStatus: WalletLifecycle = failed.length === 0 ? "verified" : input.verifiedTradeCycles >= 5 && input.pricingCoverage >= 70 && input.historyDays >= 7 ? "reviewing" : "candidate";
  return { policyVersion: WALLET_VERIFICATION_POLICY.version, eligibleStatus, passed, failed };
}

export function calculateDataQualityV3(input: { transaction: number; pricing: number; liquidity: number; fees: number; priorityFees: number; risk: number; drawdownAvailable: boolean; tradeCycles: number }) {
  return Math.round(input.transaction * .15 + input.pricing * .2 + input.liquidity * .15 + input.fees * .1 + input.priorityFees * .05 + input.risk * .15 + (input.drawdownAvailable ? 100 : 0) * .1 + input.tradeCycles * .1);
}
