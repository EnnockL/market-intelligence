import { deterministicDigest } from "@/domain/events";

export const WALLET_PROMOTION_POLICY = {
  version: "wallet-candidate-promotion-v1",
  minimumScore: 50,
  minimumDataQuality: 70,
  minimumObservedTransactions: 10,
  minimumSuccessRate: 0.8,
  minimumActiveDays: 1,
  criticalRiskFlags: ["invalid_address", "known_scam", "program_account"],
} as const;

export type PromotionState =
  "candidate" | "tracked" | "reviewing" | "verified" | "rejected";
export type PromotionRequirementStatus = "PASS" | "FAIL" | "UNKNOWN";
export interface PromotionInput {
  candidateId: string;
  currentState: PromotionState;
  score: number;
  dataQuality: number;
  observedTransactions: number;
  successfulTransactions: number;
  activeDays: number;
  riskFlags: readonly string[];
  walletId: string | null;
  verificationStatus: "candidate" | "reviewing" | "verified" | null;
  verificationEvaluationId: string | null;
}

export function evaluateWalletPromotion(input: PromotionInput) {
  const successRate =
    input.observedTransactions > 0
      ? input.successfulTransactions / input.observedTransactions
      : null;
  const criticalFlags = input.riskFlags.filter((flag) =>
    (WALLET_PROMOTION_POLICY.criticalRiskFlags as readonly string[]).includes(
      flag,
    ),
  );
  const requirements = [
    requirement(
      "DISCOVERY_SCORE",
      input.score >= WALLET_PROMOTION_POLICY.minimumScore ? "PASS" : "FAIL",
      input.score,
      WALLET_PROMOTION_POLICY.minimumScore,
    ),
    requirement(
      "DATA_QUALITY",
      input.dataQuality >= WALLET_PROMOTION_POLICY.minimumDataQuality
        ? "PASS"
        : "FAIL",
      input.dataQuality,
      WALLET_PROMOTION_POLICY.minimumDataQuality,
    ),
    requirement(
      "TRANSACTION_SAMPLE",
      input.observedTransactions >=
        WALLET_PROMOTION_POLICY.minimumObservedTransactions
        ? "PASS"
        : "FAIL",
      input.observedTransactions,
      WALLET_PROMOTION_POLICY.minimumObservedTransactions,
    ),
    requirement(
      "SUCCESS_RATE",
      successRate === null
        ? "UNKNOWN"
        : successRate >= WALLET_PROMOTION_POLICY.minimumSuccessRate
          ? "PASS"
          : "FAIL",
      successRate,
      WALLET_PROMOTION_POLICY.minimumSuccessRate,
    ),
    requirement(
      "ACTIVITY_HISTORY",
      input.activeDays >= WALLET_PROMOTION_POLICY.minimumActiveDays
        ? "PASS"
        : "FAIL",
      input.activeDays,
      WALLET_PROMOTION_POLICY.minimumActiveDays,
    ),
    requirement(
      "CRITICAL_RISK",
      criticalFlags.length ? "FAIL" : "PASS",
      criticalFlags,
      [],
    ),
  ];
  let state: PromotionState;
  if (criticalFlags.length) state = "rejected";
  else if (input.verificationStatus === "verified") state = "verified";
  else if (input.verificationStatus === "reviewing") state = "reviewing";
  else if (
    input.currentState === "verified" ||
    input.currentState === "reviewing" ||
    input.currentState === "rejected"
  )
    state = input.currentState;
  else if (input.walletId) state = "tracked";
  else
    state = requirements.every((item) => item.status === "PASS")
      ? "tracked"
      : "candidate";
  const blockers = requirements
    .filter((item) => item.status !== "PASS")
    .map((item) => item.code);
  const result = {
    policyVersion: WALLET_PROMOTION_POLICY.version,
    state,
    requirements,
    blockers,
    shouldCreateWallet: state === "tracked" && !input.walletId,
  };
  return {
    ...result,
    inputHash: deterministicDigest({
      policy: WALLET_PROMOTION_POLICY,
      input,
      result,
    }),
  };
}

function requirement(
  code: string,
  status: PromotionRequirementStatus,
  observed: unknown,
  required: unknown,
) {
  return { code, status, observed, required };
}
