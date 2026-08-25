import { describe, expect, it } from "vitest";
import { evaluateWalletPromotion } from "@/domain/wallet-promotion";

const ready = {
  candidateId: "candidate-1",
  currentState: "candidate",
  score: 70,
  dataQuality: 90,
  observedTransactions: 20,
  successfulTransactions: 19,
  activeDays: 8,
  riskFlags: ["profitability_unverified"],
  walletId: null,
  verificationStatus: null,
  verificationEvaluationId: null,
} as const;

describe("wallet candidate promotion", () => {
  it("promotes evidence-backed discovery to tracked without claiming verification", () =>
    expect(evaluateWalletPromotion(ready)).toMatchObject({
      state: "tracked",
      shouldCreateWallet: true,
      blockers: [],
    }));
  it("keeps incomplete discovery candidate with explicit blockers", () => {
    const result = evaluateWalletPromotion({
      ...ready,
      score: 30,
      dataQuality: 40,
      observedTransactions: 3,
    });
    expect(result.state).toBe("candidate");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "DISCOVERY_SCORE",
        "DATA_QUALITY",
        "TRANSACTION_SAMPLE",
      ]),
    );
  });
  it("rejects only explicit critical risk evidence", () =>
    expect(
      evaluateWalletPromotion({ ...ready, riskFlags: ["known_scam"] }),
    ).toMatchObject({ state: "rejected", shouldCreateWallet: false }));
  it("uses the immutable verification result for reviewing and verified", () => {
    expect(
      evaluateWalletPromotion({
        ...ready,
        walletId: "wallet-1",
        verificationStatus: "reviewing",
        verificationEvaluationId: "eval-1",
      }).state,
    ).toBe("reviewing");
    expect(
      evaluateWalletPromotion({
        ...ready,
        walletId: "wallet-1",
        verificationStatus: "verified",
        verificationEvaluationId: "eval-2",
      }).state,
    ).toBe("verified");
  });
  it("does not silently downgrade an advanced or terminal state", () => {
    expect(
      evaluateWalletPromotion({ ...ready, currentState: "verified" }).state,
    ).toBe("verified");
    expect(
      evaluateWalletPromotion({ ...ready, currentState: "rejected" }).state,
    ).toBe("rejected");
  });
  it("is deterministic for the same evidence", () =>
    expect(evaluateWalletPromotion(ready).inputHash).toBe(
      evaluateWalletPromotion(ready).inputHash,
    ));
});
