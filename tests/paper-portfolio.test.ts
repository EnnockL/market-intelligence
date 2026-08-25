import { describe, expect, it } from "vitest";
import {
  INITIAL_POLICIES,
  equityPoint,
  evaluateEligibility,
  selectExit,
  simulateBuy,
  type CandidateFacts,
  type PortfolioFacts,
} from "@/domain/paper-portfolio";
const candidate = (change: Partial<CandidateFacts> = {}): CandidateFacts => ({
  candidateId: "c",
  opportunityId: null,
  revisionNumber: 1,
  assetId: "a",
  state: "QUALIFIED",
  safety: "PASS",
  dataQuality: 90,
  relationshipCoverage: 90,
  clusterAdjustedCount: 3,
  priceMoveBeforeDetectionPct: 10,
  signalAvailableAt: "2026-01-01T00:00:00Z",
  decisionCutoff: "2026-01-01T00:00:00Z",
  ...change,
});
const portfolio = (change: Partial<PortfolioFacts> = {}): PortfolioFacts => ({
  cash: 20_000,
  equity: 20_000,
  initialCash: 20_000,
  openPositions: 0,
  jackpotExposure: 0,
  tokenExposure: 0,
  dailyNewExposure: 0,
  ...change,
});
describe("paper portfolio v1", () => {
  it("enters qualified candidates with fixed deterministic sizing", () =>
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate(),
        portfolio(),
      ),
    ).toMatchObject({ eligible: true, requestedAmount: 500 }));
  it("rejects rejected candidates and UNKNOWN safety", () => {
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate({ state: "REJECTED" }),
        portfolio(),
      ).reason,
    ).toBe("CANDIDATE_NOT_QUALIFIED");
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate({ safety: "UNKNOWN" }),
        portfolio(),
      ).reason,
    ).toBe("SAFETY_UNKNOWN");
  });
  it("requires known independence", () =>
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.INDEPENDENCE_REQUIRED,
        candidate({ clusterAdjustedCount: null }),
        portfolio(),
      ).reason,
    ).toBe("INDEPENDENCE_UNKNOWN"));
  it("enforces early detection and equity sizing", () => {
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.EARLY_DETECTION,
        candidate({ priceMoveBeforeDetectionPct: 26 }),
        portfolio(),
      ).reason,
    ).toBe("TOO_LATE");
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.EQUITY_1_PERCENT,
        candidate(),
        portfolio(),
      ).requestedAmount,
    ).toBe(200);
  });
  it("caps size by cash and portfolio risk", () =>
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate(),
        portfolio({ cash: 50 }),
      ).requestedAmount,
    ).toBe(50));
  it("rejects missing liquidity and models partial fill, fees and slippage", () => {
    expect(
      simulateBuy({
        requestedAmount: 500,
        expectedPrice: 10,
        liquiditySek: null,
        policy: INITIAL_POLICIES.FIXED_SMALL,
      }),
    ).toMatchObject({
      status: "REJECTED",
      reason: "INSUFFICIENT_LIQUIDITY_DATA",
    });
    const fill = simulateBuy({
      requestedAmount: 500,
      expectedPrice: 10,
      liquiditySek: 50_000,
      policy: INITIAL_POLICIES.FIXED_SMALL,
    });
    expect(fill.status).toBe("PARTIALLY_FILLED");
    if (fill.status !== "REJECTED") {
      expect(fill.executedAmount).toBe(250);
      expect(fill.executionPrice).toBeGreaterThan(10);
      expect(fill.fees.total).toBeGreaterThan(0);
    }
  });
  it("supports target, stop, time and staged exit percentages", () => {
    const target = selectExit(INITIAL_POLICIES.FIXED_SMALL.exits, {
      entryPrice: 10,
      currentPrice: 20,
      openedAt: "2026-01-01T00:00:00Z",
      observedAt: "2026-01-01T01:00:00Z",
      highWatermark: 20,
    });
    expect(target).toMatchObject({ type: "TARGET_MULTIPLE", sellPercent: 25 });
    expect(
      selectExit(INITIAL_POLICIES.FIXED_SMALL.exits, {
        entryPrice: 10,
        currentPrice: 6,
        openedAt: "2026-01-01T00:00:00Z",
        observedAt: "2026-01-01T01:00:00Z",
        highWatermark: 10,
      })?.type,
    ).toBe("STOP_LOSS");
  });
  it("accounts cash, market value and unrealized pnl", () =>
    expect(
      equityPoint(1000, [{ quantity: 10, price: 12, costBasis: 100 }]),
    ).toEqual({
      cash: 1000,
      openPositionValue: 120,
      unrealizedPnl: 20,
      totalEquity: 1120,
    }));
  it("is deterministic and policy-isolated", () => {
    const a = evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate(),
        portfolio(),
      ),
      b = evaluateEligibility(
        INITIAL_POLICIES.FIXED_SMALL,
        candidate(),
        portfolio(),
      );
    expect(a).toEqual(b);
    expect(
      evaluateEligibility(
        INITIAL_POLICIES.EARLY_DETECTION,
        candidate({ priceMoveBeforeDetectionPct: null }),
        portfolio(),
      ).eligible,
    ).toBe(false);
  });
});
