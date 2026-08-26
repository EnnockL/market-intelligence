import { deterministicDigest } from "./events";

export const STRATEGY_VALIDATION_PROTOCOL_VERSION = "strategy-validation-protocol-v1";
export type GateStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type ValidationDecision = "APPROVED" | "REJECTED" | "INSUFFICIENT_DATA";
export type ValidationPhase = "LEARNING" | "FROZEN" | "OUT_OF_SAMPLE" | "DEMO_VALIDATION";

export interface ValidationProtocol {
  version: string;
  minimumTrades: number;
  minimumDataQuality: number;
  minimumIndependentPeriods: number;
  minimumRegimes: number;
  minimumProfitFactor: number;
  maximumDrawdownR: number;
  maximumTopTradePnlShare: number;
  maximumTopAssetPnlShare: number;
  minimumModeledLiveEvR: number;
  minimumStressEvR: number;
  confidenceLevel: number;
}

export const VALIDATION_PROTOCOL_V1: ValidationProtocol = {
  version: STRATEGY_VALIDATION_PROTOCOL_VERSION,
  minimumTrades: 30,
  minimumDataQuality: 80,
  minimumIndependentPeriods: 2,
  minimumRegimes: 2,
  minimumProfitFactor: 1,
  maximumDrawdownR: 20,
  maximumTopTradePnlShare: 0.35,
  maximumTopAssetPnlShare: 0.6,
  minimumModeledLiveEvR: 0,
  minimumStressEvR: 0,
  confidenceLevel: 0.95,
};

export interface ValidationTrade {
  tradeId: string;
  assetId: string;
  enteredAt: string;
  exitedAt: string;
  rMultiple: number;
  modeledLiveR: number | null;
  stressR: number | null;
  regime: string;
  availableAt: string;
}

export interface ValidationInput {
  strategyId: string;
  strategyVersion: number;
  phase: ValidationPhase;
  windowStart: string;
  windowEnd: string;
  informationCutoffAt: string;
  datasetHash: string;
  hypothesisId: string;
  invalidationCondition: string | null;
  dataQuality: number | null;
  independentPeriods: number | null;
  trades: ValidationTrade[];
}

export interface ValidationGate {
  code: string;
  status: GateStatus;
  observedValue: unknown;
  requiredValue: unknown;
  reason: string | null;
}

export function evaluateStrategyValidation(input: ValidationInput, protocol: ValidationProtocol = VALIDATION_PROTOCOL_V1) {
  assertWindow(input);
  const trades = [...input.trades]
    .filter((trade) => trade.enteredAt >= input.windowStart && trade.exitedAt <= input.windowEnd)
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt) || a.tradeId.localeCompare(b.tradeId));
  for (const trade of trades) if (trade.availableAt > input.informationCutoffAt) throw new Error("FUTURE_TRADE_EVIDENCE_REJECTED");

  const values = trades.map((trade) => trade.rMultiple);
  const modeled = complete(trades.map((trade) => trade.modeledLiveR));
  const stressed = complete(trades.map((trade) => trade.stressR));
  const mean = average(values);
  const interval = meanConfidenceInterval(values, protocol.confidenceLevel);
  const profitFactor = ratio(values.filter((value) => value > 0), values.filter((value) => value < 0).map(Math.abs));
  const maxDrawdownR = maximumDrawdown(values);
  const totalPositive = values.filter((value) => value > 0).reduce(sum, 0);
  const topTradeShare = totalPositive > 0 ? Math.max(...values, 0) / totalPositive : null;
  const assetPnl = groupSum(trades, (trade) => trade.assetId, (trade) => Math.max(0, trade.rMultiple));
  const topAssetShare = totalPositive > 0 ? Math.max(...Object.values(assetPnl), 0) / totalPositive : null;
  const regimes = new Set(trades.map((trade) => trade.regime).filter((value) => value !== "UNKNOWN")).size;
  const withoutBest = values.length > 1 ? average(values.filter((_, index) => index !== indexOfMaximum(values))) : null;
  const statisticalEvidenceAvailable = trades.length >= protocol.minimumTrades;

  const gates: ValidationGate[] = [
    present("HYPOTHESIS_REGISTERED", input.hypothesisId, "VERSIONED_HYPOTHESIS_REQUIRED"),
    present("TRADE_INVALIDATION_DEFINED", input.invalidationCondition, "EXPLICIT_INVALIDATION_REQUIRED"),
    numberGate("DATA_QUALITY", input.dataQuality, `>= ${protocol.minimumDataQuality}`, (value) => value >= protocol.minimumDataQuality),
    evidenceCoverageGate("SAMPLE_SIZE", trades.length, `>= ${protocol.minimumTrades}`, (value) => value >= protocol.minimumTrades),
    evidenceCoverageGate("INDEPENDENT_PERIODS", input.independentPeriods, `>= ${protocol.minimumIndependentPeriods}`, (value) => value >= protocol.minimumIndependentPeriods),
    evidenceCoverageGate("REGIME_COVERAGE", regimes, `>= ${protocol.minimumRegimes}`, (value) => value >= protocol.minimumRegimes),
    numberGate("PROFIT_FACTOR", statisticalEvidenceAvailable ? profitFactor : null, `> ${protocol.minimumProfitFactor}`, (value) => value > protocol.minimumProfitFactor),
    numberGate("EXPECTANCY_CONFIDENCE", statisticalEvidenceAvailable ? interval?.lower ?? null : null, "> 0R", (value) => value > 0),
    numberGate("MAX_DRAWDOWN", statisticalEvidenceAvailable ? maxDrawdownR : null, `<= ${protocol.maximumDrawdownR}R`, (value) => value <= protocol.maximumDrawdownR),
    numberGate("BEST_TRADE_DEPENDENCE", statisticalEvidenceAvailable ? topTradeShare : null, `<= ${protocol.maximumTopTradePnlShare}`, (value) => value <= protocol.maximumTopTradePnlShare),
    numberGate("ASSET_CONCENTRATION", statisticalEvidenceAvailable ? topAssetShare : null, `<= ${protocol.maximumTopAssetPnlShare}`, (value) => value <= protocol.maximumTopAssetPnlShare),
    numberGate("EDGE_WITHOUT_BEST_TRADE", statisticalEvidenceAvailable ? withoutBest : null, "> 0R", (value) => value > 0),
    numberGate("MODELED_LIVE_EXPECTANCY", statisticalEvidenceAvailable && modeled ? average(modeled) : null, `> ${protocol.minimumModeledLiveEvR}R`, (value) => value > protocol.minimumModeledLiveEvR),
    numberGate("STRESS_EXPECTANCY", statisticalEvidenceAvailable && stressed ? average(stressed) : null, `> ${protocol.minimumStressEvR}R`, (value) => value > protocol.minimumStressEvR),
  ];
  const decision: ValidationDecision = gates.some((gate) => gate.status === "FAIL") ? "REJECTED" : gates.some((gate) => gate.status === "UNKNOWN") ? "INSUFFICIENT_DATA" : "APPROVED";
  const result = { protocolVersion: protocol.version, decision, gates, metrics: { sampleSize: trades.length, expectedValueR: mean, confidenceInterval: interval, profitFactor, maxDrawdownR, topTradePnlShare: topTradeShare, topAssetPnlShare: topAssetShare, expectedValueWithoutBestTradeR: withoutBest, modeledLiveExpectedValueR: modeled ? average(modeled) : null, stressExpectedValueR: stressed ? average(stressed) : null, regimeCount: regimes }, inputTradeIds: trades.map((trade) => trade.tradeId) };
  const identity = { strategyId: input.strategyId, strategyVersion: input.strategyVersion, phase: input.phase, windowStart: input.windowStart, windowEnd: input.windowEnd, informationCutoffAt: input.informationCutoffAt, datasetHash: input.datasetHash, hypothesisId: input.hypothesisId, protocolVersion: protocol.version };
  return { ...result, validationKey: `validation_${deterministicDigest(identity).slice(0, 40)}`, resultHash: deterministicDigest(result) };
}

function assertWindow(input: ValidationInput) { if (input.windowStart > input.windowEnd || input.windowEnd > input.informationCutoffAt) throw new Error("INVALID_POINT_IN_TIME_WINDOW"); }
function present(code: string, value: string | null, reason: string): ValidationGate { return { code, status: value?.trim() ? "PASS" : "UNKNOWN", observedValue: value, requiredValue: "NON_EMPTY", reason: value?.trim() ? null : reason }; }
function numberGate(code: string, value: number | null, requiredValue: unknown, predicate: (value: number) => boolean): ValidationGate { const status: GateStatus = value === null || !Number.isFinite(value) ? "UNKNOWN" : predicate(value) ? "PASS" : "FAIL"; return { code, status, observedValue: value, requiredValue, reason: status === "PASS" ? null : `${code}_${status}` }; }
function evidenceCoverageGate(code: string, value: number | null, requiredValue: unknown, predicate: (value: number) => boolean): ValidationGate { const status: GateStatus = value === null || !Number.isFinite(value) || !predicate(value) ? "UNKNOWN" : "PASS"; return { code, status, observedValue: value, requiredValue, reason: status === "PASS" ? null : `${code}_INSUFFICIENT_DATA` }; }
function average(values: number[]) { return values.length ? values.reduce(sum, 0) / values.length : null; }
function sum(a: number, b: number) { return a + b; }
function ratio(wins: number[], losses: number[]) { const loss = losses.reduce(sum, 0); return loss > 0 ? wins.reduce(sum, 0) / loss : null; }
function maximumDrawdown(values: number[]) { if (!values.length) return null; let equity = 0, peak = 0, maximum = 0; for (const value of values) { equity += value; peak = Math.max(peak, equity); maximum = Math.max(maximum, peak - equity); } return maximum; }
function meanConfidenceInterval(values: number[], confidence: number) { if (values.length < 2) return null; const mean = average(values)!; const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1); const z = confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645; const margin = z * Math.sqrt(variance / values.length); return { lower: mean - margin, upper: mean + margin, confidence }; }
function complete(values: Array<number | null>) { return values.length && values.every((value): value is number => value !== null && Number.isFinite(value)) ? values : null; }
function groupSum<T>(values: T[], key: (value: T) => string, number: (value: T) => number) { return values.reduce<Record<string, number>>((result, value) => ({ ...result, [key(value)]: (result[key(value)] ?? 0) + number(value) }), {}); }
function indexOfMaximum(values: number[]) { return values.reduce((best, value, index) => value > values[best] ? index : best, 0); }
