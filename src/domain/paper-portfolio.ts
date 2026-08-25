export const PAPER_ENGINE_VERSION = "paper-engine-v1";
export const FEE_MODEL_VERSION = "solana-fees-v1";
export const SLIPPAGE_MODEL_VERSION = "liquidity-impact-v1";

export type PolicyKind =
  | "FIXED_SMALL"
  | "EQUITY_1_PERCENT"
  | "INDEPENDENCE_REQUIRED"
  | "EARLY_DETECTION";
export type MissingDataRule = "REJECT" | "ALLOW";
export interface PaperPolicyConfig {
  kind: PolicyKind;
  fixedAmountSek?: number;
  equityPercent?: number;
  requireQualified: boolean;
  allowedSafety: ("PASS" | "UNKNOWN" | "FAIL")[];
  minimumDataQuality: number;
  minimumRelationshipCoverage?: number;
  requireClusterAdjustedCount?: boolean;
  maximumPriorMovePct?: number;
  entryDelayMs: number;
  requireLiquidity: boolean;
  maxLiquidityParticipationPct: number;
  liquidityConstraint: "CAP" | "REJECT";
  maxPositionPct: number;
  maxSimultaneousPositions: number;
  maxJackpotAllocationPct: number;
  maxExposurePerTokenPct: number;
  maxDailyNewExposurePct: number;
  missingDataRule: MissingDataRule;
  exits: ExitRule[];
}
export type ExitRule = {
  type: "STOP_LOSS" | "TARGET_MULTIPLE" | "TIME_BASED" | "TRAILING_EXIT";
  value: number;
  sellPercent: number;
  priority: number;
};
export interface CandidateFacts {
  candidateId: string;
  opportunityId: string | null;
  revisionNumber: number;
  assetId: string;
  state: string;
  safety: "PASS" | "FAIL" | "UNKNOWN";
  dataQuality: number | null;
  relationshipCoverage: number | null;
  clusterAdjustedCount: number | null;
  priceMoveBeforeDetectionPct: number | null;
  signalAvailableAt: string;
  decisionCutoff: string;
}
export interface PortfolioFacts {
  cash: number;
  equity: number;
  initialCash: number;
  openPositions: number;
  jackpotExposure: number;
  tokenExposure: number;
  dailyNewExposure: number;
}
export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  requestedAmount: number;
  knownInputs: Record<string, unknown>;
}

export const INITIAL_POLICIES: Record<PolicyKind, PaperPolicyConfig> = {
  FIXED_SMALL: base({ kind: "FIXED_SMALL", fixedAmountSek: 500 }),
  EQUITY_1_PERCENT: base({ kind: "EQUITY_1_PERCENT", equityPercent: 1 }),
  INDEPENDENCE_REQUIRED: base({
    kind: "INDEPENDENCE_REQUIRED",
    fixedAmountSek: 500,
    minimumRelationshipCoverage: 80,
    requireClusterAdjustedCount: true,
  }),
  EARLY_DETECTION: base({
    kind: "EARLY_DETECTION",
    fixedAmountSek: 500,
    maximumPriorMovePct: 25,
  }),
};
function base(
  partial: Partial<PaperPolicyConfig> & Pick<PaperPolicyConfig, "kind">,
): PaperPolicyConfig {
  return {
    requireQualified: true,
    allowedSafety: ["PASS"],
    minimumDataQuality: 60,
    entryDelayMs: 5000,
    requireLiquidity: true,
    maxLiquidityParticipationPct: 0.5,
    liquidityConstraint: "CAP",
    maxPositionPct: 5,
    maxSimultaneousPositions: 10,
    maxJackpotAllocationPct: 5,
    maxExposurePerTokenPct: 5,
    maxDailyNewExposurePct: 10,
    missingDataRule: "REJECT",
    exits: [
      { type: "STOP_LOSS", value: 0.3, sellPercent: 100, priority: 1 },
      { type: "TARGET_MULTIPLE", value: 2, sellPercent: 25, priority: 2 },
      { type: "TARGET_MULTIPLE", value: 5, sellPercent: 25, priority: 3 },
      { type: "TARGET_MULTIPLE", value: 10, sellPercent: 25, priority: 4 },
      { type: "TIME_BASED", value: 24, sellPercent: 100, priority: 5 },
    ],
    ...partial,
  };
}

export function evaluateEligibility(
  policy: PaperPolicyConfig,
  candidate: CandidateFacts,
  portfolio: PortfolioFacts,
): EligibilityResult {
  const knownInputs = {
    state: candidate.state,
    safety: candidate.safety,
    dataQuality: candidate.dataQuality,
    relationshipCoverage: candidate.relationshipCoverage,
    clusterAdjustedCount: candidate.clusterAdjustedCount,
    priceMoveBeforeDetectionPct: candidate.priceMoveBeforeDetectionPct,
  };
  const reject = (reason: string): EligibilityResult => ({
    eligible: false,
    reason,
    requestedAmount: 0,
    knownInputs,
  });
  if (policy.requireQualified && candidate.state !== "QUALIFIED")
    return reject("CANDIDATE_NOT_QUALIFIED");
  if (!policy.allowedSafety.includes(candidate.safety))
    return reject(
      candidate.safety === "UNKNOWN" ? "SAFETY_UNKNOWN" : "SAFETY_REJECTED",
    );
  if (
    candidate.dataQuality === null ||
    candidate.dataQuality < policy.minimumDataQuality
  )
    return reject(
      candidate.dataQuality === null
        ? "DATA_QUALITY_UNKNOWN"
        : "DATA_QUALITY_TOO_LOW",
    );
  if (
    policy.minimumRelationshipCoverage !== undefined &&
    (candidate.relationshipCoverage === null ||
      candidate.relationshipCoverage < policy.minimumRelationshipCoverage)
  )
    return reject(
      candidate.relationshipCoverage === null
        ? "RELATIONSHIP_COVERAGE_UNKNOWN"
        : "RELATIONSHIP_COVERAGE_TOO_LOW",
    );
  if (
    policy.requireClusterAdjustedCount &&
    candidate.clusterAdjustedCount === null
  )
    return reject("INDEPENDENCE_UNKNOWN");
  if (
    policy.maximumPriorMovePct !== undefined &&
    (candidate.priceMoveBeforeDetectionPct === null ||
      candidate.priceMoveBeforeDetectionPct > policy.maximumPriorMovePct)
  )
    return reject(
      candidate.priceMoveBeforeDetectionPct === null
        ? "PRIOR_MOVE_UNKNOWN"
        : "TOO_LATE",
    );
  if (portfolio.openPositions >= policy.maxSimultaneousPositions)
    return reject("MAX_POSITIONS_REACHED");
  let amount =
    policy.fixedAmountSek ??
    (portfolio.equity * (policy.equityPercent ?? 0)) / 100;
  amount = Math.min(
    amount,
    (portfolio.equity * policy.maxPositionPct) / 100,
    (portfolio.equity * policy.maxExposurePerTokenPct) / 100 -
      portfolio.tokenExposure,
    (portfolio.equity * policy.maxJackpotAllocationPct) / 100 -
      portfolio.jackpotExposure,
    (portfolio.initialCash * policy.maxDailyNewExposurePct) / 100 -
      portfolio.dailyNewExposure,
    portfolio.cash,
  );
  amount = round(amount);
  return amount > 0
    ? {
        eligible: true,
        reason: "ELIGIBLE",
        requestedAmount: amount,
        knownInputs,
      }
    : reject("RISK_CAP_OR_CASH_EXHAUSTED");
}

export interface ExecutionInput {
  requestedAmount: number;
  expectedPrice: number;
  liquiditySek: number | null;
  policy: PaperPolicyConfig;
}
export function simulateBuy(input: ExecutionInput) {
  if (!(input.expectedPrice > 0))
    return { status: "REJECTED" as const, reason: "MISSING_PRICE" };
  if (
    input.policy.requireLiquidity &&
    !(input.liquiditySek && input.liquiditySek > 0)
  )
    return {
      status: "REJECTED" as const,
      reason: "INSUFFICIENT_LIQUIDITY_DATA",
    };
  const maxFromLiquidity =
    input.liquiditySek === null
      ? input.requestedAmount
      : (input.liquiditySek * input.policy.maxLiquidityParticipationPct) / 100;
  if (
    input.policy.liquidityConstraint === "REJECT" &&
    input.requestedAmount > maxFromLiquidity
  )
    return {
      status: "REJECTED" as const,
      reason: "POSITION_TOO_LARGE_FOR_LIQUIDITY",
    };
  const principal = round(Math.min(input.requestedAmount, maxFromLiquidity));
  if (principal <= 0)
    return {
      status: "REJECTED" as const,
      reason: "POSITION_TOO_LARGE_FOR_LIQUIDITY",
    };
  const impactPct = input.liquiditySek
    ? Math.min(10, (principal / input.liquiditySek) * 50)
    : 0;
  const executionPrice = input.expectedPrice * (1 + impactPct / 100);
  const networkFee = 0.05,
    priorityFee = 0.1,
    dexFee = principal * 0.003,
    routeFee = principal * 0.0005,
    totalFees = round(networkFee + priorityFee + dexFee + routeFee);
  return {
    status:
      principal < input.requestedAmount
        ? ("PARTIALLY_FILLED" as const)
        : ("FILLED" as const),
    reason: null,
    executedAmount: principal,
    expectedPrice: input.expectedPrice,
    executionPrice,
    quantity: principal / executionPrice,
    fees: {
      networkFee,
      priorityFee,
      dexFee: round(dexFee),
      routeFee: round(routeFee),
      total: totalFees,
      estimated: true,
      modelVersion: FEE_MODEL_VERSION,
    },
    slippage: {
      pct: impactPct,
      sek: round((principal * impactPct) / 100),
      modelVersion: SLIPPAGE_MODEL_VERSION,
    },
    maxFromLiquidity: round(maxFromLiquidity),
  };
}

export function selectExit(
  rules: ExitRule[],
  input: {
    entryPrice: number;
    currentPrice: number;
    openedAt: string;
    observedAt: string;
    highWatermark: number;
  },
) {
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    const multiple = input.currentPrice / input.entryPrice;
    if (rule.type === "STOP_LOSS" && multiple <= 1 - rule.value) return rule;
    if (rule.type === "TARGET_MULTIPLE" && multiple >= rule.value) return rule;
    if (
      rule.type === "TIME_BASED" &&
      Date.parse(input.observedAt) - Date.parse(input.openedAt) >=
        rule.value * 3600000
    )
      return rule;
    if (
      rule.type === "TRAILING_EXIT" &&
      input.currentPrice <= input.highWatermark * (1 - rule.value)
    )
      return rule;
  }
  return null;
}
export function equityPoint(
  cash: number,
  positions: { quantity: number; price: number; costBasis: number }[],
) {
  const openValue = positions.reduce((s, p) => s + p.quantity * p.price, 0),
    cost = positions.reduce((s, p) => s + p.costBasis, 0);
  return {
    cash: round(cash),
    openPositionValue: round(openValue),
    unrealizedPnl: round(openValue - cost),
    totalEquity: round(cash + openValue),
  };
}
function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
