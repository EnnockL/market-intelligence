import { deterministicDigest } from "./events";
import { marketTimeContext, type MarketSession, type SessionWindow } from "./market-time";
import type { MarketCandle } from "./technical-structure";

export const STRATEGY_LAB_VERSION = "strategy-pattern-lab-v2";
export const MIN_STRATEGY_SAMPLE_SIZE = 30;
export type StrategySetupType = "SESSION_SWEEP_REVERSAL" | "EMA_VWAP_MOMENTUM" | "OPENING_RANGE_BREAKOUT";
export interface StrategyDefinition {
  strategyId: string; version: number; name: string; market: string; timeframe: string; setupType: StrategySetupType;
  exchangeTimeZone: string; referenceSession?: MarketSession; allowedSession: MarketSession; sessionWindows: SessionWindow[];
  rejectionCloseInside: boolean; stopBufferBps: number; targetPolicy: "OPPOSITE_REFERENCE_LEVEL" | "FIXED_R"; targetR?: number;
  fastEmaPeriod?: number; slowEmaPeriod?: number;
  openingRangeMinutes?: number; breakoutConfirmation?: "CLOSE"; requireRetest?: boolean; retestToleranceBps?: number; retestMaxCandles?: number;
  entryCutoffMinutes?: number; minimumBreakoutVolumeMultiple?: number; requireVwapConfirmation?: boolean;
  feeBps: number; slippageBps: number; minimumSampleSize: number;
}
export interface StrategyTrade { tradeKey: string; side: "LONG" | "SHORT"; setupAt: string; enteredAt: string; exitedAt: string; entry: number; stop: number; target: number; exit: number; outcome: "WIN" | "LOSS" | "TIME_EXIT"; rMultiple: number; mfeR: number; maeR: number; holdMinutes: number; evidenceRefs: string[]; session: string; weekday: string; regime: string; entryHour: string; volatilityBucket: string; }

export function evaluateStrategy(definition: StrategyDefinition, sourceCandles: MarketCandle[], cutoffAt: string, regimeAt: (at: string) => string = () => "UNKNOWN") {
  validateDefinition(definition);
  const candles = sourceCandles.filter(item => item.timeframe === definition.timeframe && item.closedAt <= cutoffAt && item.availableAt <= cutoffAt).sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));
  const evaluated = definition.setupType === "SESSION_SWEEP_REVERSAL" ? { trades: sweepReversalTrades(definition, candles, regimeAt), setupCount: null } : definition.setupType === "EMA_VWAP_MOMENTUM" ? { trades: emaVwapTrades(definition, candles, regimeAt), setupCount: null } : openingRangeBreakoutTrades(definition, candles, regimeAt);
  const trades = evaluated.trades;
  const metrics = aggregateTrades(trades, definition.minimumSampleSize);
  const inputHash = deterministicDigest({ definition, cutoffAt, candleIds: candles.map(item => item.id) });
  return { version: STRATEGY_LAB_VERSION, strategyId: definition.strategyId, strategyVersion: definition.version, cutoffAt, inputHash, candleCount: candles.length, setupCount: evaluated.setupCount ?? trades.length, tradeCount: trades.length, trades, ...metrics };
}

export function aggregateTrades(trades: StrategyTrade[], minimumSampleSize = MIN_STRATEGY_SAMPLE_SIZE) {
  const enough = trades.length >= minimumSampleSize, wins = trades.filter(item => item.rMultiple > 0), losses = trades.filter(item => item.rMultiple < 0);
  const grossWin = wins.reduce((sum, item) => sum + item.rMultiple, 0), grossLoss = Math.abs(losses.reduce((sum, item) => sum + item.rMultiple, 0));
  const equity = trades.reduce<number[]>((values, item) => [...values, values.at(-1)! + item.rMultiple], [0]); let peak = 0, maxDrawdown = 0;
  for (const value of equity) { peak = Math.max(peak, value); maxDrawdown = Math.min(maxDrawdown, value - peak); }
  const raw = { winRate: trades.length ? wins.length / trades.length * 100 : null, lossRate: trades.length ? losses.length / trades.length * 100 : null, profitFactor: grossLoss ? grossWin / grossLoss : null, expectedValueR: trades.length ? trades.reduce((sum, item) => sum + item.rMultiple, 0) / trades.length : null, averageR: trades.length ? trades.reduce((sum, item) => sum + item.rMultiple, 0) / trades.length : null, averageMfeR: trades.length ? trades.reduce((sum, item) => sum + item.mfeR, 0) / trades.length : null, averageMaeR: trades.length ? trades.reduce((sum, item) => sum + item.maeR, 0) / trades.length : null, maxDrawdownR: trades.length ? maxDrawdown : null, averageHoldMinutes: trades.length ? trades.reduce((sum, item) => sum + item.holdMinutes, 0) / trades.length : null };
  return { status: enough ? "AVAILABLE" as const : "INSUFFICIENT_DATA" as const, reason: enough ? null : "MINIMUM_SAMPLE_SIZE_NOT_MET", sampleSize: trades.length, minimumSampleSize, metrics: enough ? raw : Object.fromEntries(Object.keys(raw).map(key => [key, null])), segments: segmentPerformance(trades, minimumSampleSize) };
}

function sweepReversalTrades(definition: StrategyDefinition, candles: MarketCandle[], regimeAt: (at: string) => string) {
  const reference = definition.referenceSession ?? "NEW_YORK", sessions = candles.map(candle => ({ candle, context: marketTimeContext(candle.closedAt, definition.exchangeTimeZone, definition.sessionWindows) }));
  const refs = new Map<string, { high: number; low: number; ids: string[] }>();
  for (const item of sessions.filter(item => item.context.marketSession === reference)) {
    const key = sessionDate(item.candle.closedAt, definition.sessionWindows.find(window => window.session === reference)?.timeZone ?? definition.exchangeTimeZone);
    const current = refs.get(key) ?? { high: -Infinity, low: Infinity, ids: [] }; current.high = Math.max(current.high, item.candle.high); current.low = Math.min(current.low, item.candle.low); current.ids.push(item.candle.id); refs.set(key, current);
  }
  const trades: StrategyTrade[] = [];
  for (let index = 0; index < sessions.length; index++) {
    const item = sessions[index]; if (item.context.marketSession !== definition.allowedSession) continue;
    const previous = latestPriorReference(refs, item.candle.openedAt); if (!previous) continue;
    const highSweep = item.candle.high > previous.range.high && (!definition.rejectionCloseInside || item.candle.close < previous.range.high);
    const lowSweep = item.candle.low < previous.range.low && (!definition.rejectionCloseInside || item.candle.close > previous.range.low);
    if (!highSweep && !lowSweep) continue;
    const side = highSweep ? "SHORT" as const : "LONG" as const, entry = item.candle.close;
    const rawStop = highSweep ? item.candle.high : item.candle.low, stop = highSweep ? rawStop * (1 + definition.stopBufferBps / 10_000) : rawStop * (1 - definition.stopBufferBps / 10_000);
    const risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    const target = definition.targetPolicy === "OPPOSITE_REFERENCE_LEVEL" ? (highSweep ? previous.range.low : previous.range.high) : (side === "LONG" ? entry + risk * (definition.targetR ?? 2) : entry - risk * (definition.targetR ?? 2));
    const allowedZone = definition.sessionWindows.find(window => window.session === definition.allowedSession)?.timeZone ?? definition.exchangeTimeZone;
    const allowedDate = sessionDate(item.candle.closedAt, allowedZone);
    const path = sessions.slice(index + 1).filter(next => next.context.marketSession === definition.allowedSession && sessionDate(next.candle.closedAt, allowedZone) === allowedDate);
    let exitCandle = path.at(-1) ?? item, outcome: StrategyTrade["outcome"] = "TIME_EXIT", exit = exitCandle.candle.close, maxFavorable = 0, maxAdverse = 0;
    for (const next of path) {
      const favorable = side === "LONG" ? next.candle.high - entry : entry - next.candle.low, adverse = side === "LONG" ? entry - next.candle.low : next.candle.high - entry; maxFavorable = Math.max(maxFavorable, favorable); maxAdverse = Math.max(maxAdverse, adverse);
      const stopHit = side === "LONG" ? next.candle.low <= stop : next.candle.high >= stop, targetHit = side === "LONG" ? next.candle.high >= target : next.candle.low <= target;
      if (stopHit || targetHit) { outcome = stopHit ? "LOSS" : "WIN"; exit = stopHit ? stop : target; exitCandle = next; break; }
    }
    const costs = entry * (definition.feeBps + definition.slippageBps) / 10_000, pnl = (side === "LONG" ? exit - entry : entry - exit) - costs;
    const time = marketTimeContext(item.candle.closedAt, definition.exchangeTimeZone, definition.sessionWindows);
    trades.push({ tradeKey: deterministicDigest({ strategy: definition.strategyId, version: definition.version, candle: item.candle.id }), side, setupAt: item.candle.closedAt, enteredAt: item.candle.closedAt, exitedAt: exitCandle.candle.closedAt, entry, stop, target, exit, outcome, rMultiple: pnl / risk, mfeR: maxFavorable / risk, maeR: -maxAdverse / risk, holdMinutes: Math.max(0, (Date.parse(exitCandle.candle.closedAt) - Date.parse(item.candle.closedAt)) / 60_000), evidenceRefs: [...previous.range.ids, item.candle.id, exitCandle.candle.id], session: time.marketSession, weekday: time.weekday, regime: regimeAt(item.candle.closedAt), entryHour: time.localExchangeTime.slice(0, 2), volatilityBucket: "UNKNOWN" });
    index = sessions.indexOf(exitCandle);
  }
  return trades;
}

function emaVwapTrades(definition: StrategyDefinition, candles: MarketCandle[], regimeAt: (at: string) => string) {
  const fast = emaSeries(candles.map(item => item.close), definition.fastEmaPeriod ?? 9), slow = emaSeries(candles.map(item => item.close), definition.slowEmaPeriod ?? 20);
  const contexts = candles.map(candle => marketTimeContext(candle.closedAt, definition.exchangeTimeZone, definition.sessionWindows));
  const trades: StrategyTrade[] = [];
  for (let index = 1; index < candles.length; index++) {
    const context = contexts[index]; if (context.marketSession !== definition.allowedSession || fast[index] === null || slow[index] === null) continue;
    const session = candles.slice(0, index + 1).filter((_, candleIndex) => contexts[candleIndex].marketSession === context.marketSession && candles[candleIndex].openedAt.slice(0, 10) === candles[index].openedAt.slice(0, 10));
    const volume = session.reduce((sum, item) => sum + (item.volume ?? 0), 0); if (!(volume > 0)) continue;
    const vwap = session.reduce((sum, item) => sum + ((item.high + item.low + item.close) / 3) * (item.volume ?? 0), 0) / volume;
    const crossedUp = fast[index - 1] !== null && slow[index - 1] !== null && fast[index - 1]! <= slow[index - 1]! && fast[index]! > slow[index]!;
    const crossedDown = fast[index - 1] !== null && slow[index - 1] !== null && fast[index - 1]! >= slow[index - 1]! && fast[index]! < slow[index]!;
    const side = crossedUp && candles[index].close > vwap ? "LONG" as const : crossedDown && candles[index].close < vwap ? "SHORT" as const : null; if (!side) continue;
    const entryCandle = candles[index], entry = entryCandle.close, rawStop = side === "LONG" ? entryCandle.low : entryCandle.high;
    const stop = side === "LONG" ? rawStop * (1 - definition.stopBufferBps / 10_000) : rawStop * (1 + definition.stopBufferBps / 10_000), risk = Math.abs(entry - stop); if (!(risk > 0)) continue;
    const target = side === "LONG" ? entry + risk * (definition.targetR ?? 2) : entry - risk * (definition.targetR ?? 2);
    const allowedZone = definition.sessionWindows.find(window => window.session === definition.allowedSession)?.timeZone ?? definition.exchangeTimeZone;
    const allowedDate = sessionDate(entryCandle.closedAt, allowedZone);
    const path = candles.slice(index + 1).filter((next, offset) => contexts[index + 1 + offset]?.marketSession === definition.allowedSession && sessionDate(next.closedAt, allowedZone) === allowedDate);
    let exitCandle = path.at(-1) ?? entryCandle, exit = exitCandle.close, outcome: StrategyTrade["outcome"] = "TIME_EXIT", mfe = 0, mae = 0;
    for (const next of path) { mfe = Math.max(mfe, side === "LONG" ? next.high - entry : entry - next.low); mae = Math.max(mae, side === "LONG" ? entry - next.low : next.high - entry); const stopHit = side === "LONG" ? next.low <= stop : next.high >= stop, targetHit = side === "LONG" ? next.high >= target : next.low <= target; if (stopHit || targetHit) { outcome = stopHit ? "LOSS" : "WIN"; exit = stopHit ? stop : target; exitCandle = next; break; } }
    const costs = entry * (definition.feeBps + definition.slippageBps) / 10_000, pnl = (side === "LONG" ? exit - entry : entry - exit) - costs;
    trades.push({ tradeKey: deterministicDigest({ strategy: definition.strategyId, version: definition.version, candle: entryCandle.id }), side, setupAt: entryCandle.closedAt, enteredAt: entryCandle.closedAt, exitedAt: exitCandle.closedAt, entry, stop, target, exit, outcome, rMultiple: pnl / risk, mfeR: mfe / risk, maeR: -mae / risk, holdMinutes: Math.max(0, (Date.parse(exitCandle.closedAt) - Date.parse(entryCandle.closedAt)) / 60_000), evidenceRefs: [entryCandle.id, exitCandle.id], session: context.marketSession, weekday: context.weekday, regime: regimeAt(entryCandle.closedAt), entryHour: context.localExchangeTime.slice(0, 2), volatilityBucket: "UNKNOWN" });
    index = candles.indexOf(exitCandle);
  }
  return trades;
}

function openingRangeBreakoutTrades(definition: StrategyDefinition, candles: MarketCandle[], regimeAt: (at: string) => string) {
  const rangeMinutes = definition.openingRangeMinutes ?? 15, cutoffMinutes = definition.entryCutoffMinutes ?? 60;
  const contexts = candles.map(candle => marketTimeContext(candle.closedAt, definition.exchangeTimeZone, definition.sessionWindows));
  const zone = definition.sessionWindows.find(window => window.session === definition.allowedSession)?.timeZone ?? definition.exchangeTimeZone;
  const dates = [...new Set(candles.map(candle => sessionDate(candle.closedAt, zone)))].sort();
  const trades: StrategyTrade[] = []; let setupCount = 0;
  for (const date of dates) {
    const indices = candles.map((candle, index) => ({ candle, index, context: contexts[index] })).filter(item => item.context.marketSession === definition.allowedSession && sessionDate(item.candle.closedAt, zone) === date);
    const range = indices.filter(item => item.context.minutesSinceOpen !== null && item.context.minutesSinceOpen! > 0 && item.context.minutesSinceOpen! <= rangeMinutes);
    if (!range.length) continue;
    const rangeHigh = Math.max(...range.map(item => item.candle.high)), rangeLow = Math.min(...range.map(item => item.candle.low));
    const rangeVolume = range.map(item => item.candle.volume).filter((value): value is number => value !== null && value > 0);
    const baselineVolume = rangeVolume.length === range.length ? rangeVolume.reduce((sum, value) => sum + value, 0) / rangeVolume.length : null;
    const afterRange = indices.filter(item => item.context.minutesSinceOpen !== null && item.context.minutesSinceOpen! > rangeMinutes && item.context.minutesSinceOpen! <= cutoffMinutes);
    for (let candidateIndex = 0; candidateIndex < afterRange.length; candidateIndex++) {
      const breakout = afterRange[candidateIndex], side = breakout.candle.close > rangeHigh ? "LONG" as const : breakout.candle.close < rangeLow ? "SHORT" as const : null;
      if (!side) continue;
      const volumeMultiple = definition.minimumBreakoutVolumeMultiple ?? 0;
      if (volumeMultiple > 0 && (baselineVolume === null || breakout.candle.volume === null || breakout.candle.volume < baselineVolume * volumeMultiple)) continue;
      if (definition.requireVwapConfirmation) { const throughBreakout = indices.filter(item => item.index <= breakout.index); const volume = throughBreakout.reduce((sum, item) => sum + (item.candle.volume ?? 0), 0); if (!(volume > 0)) continue; const vwap = throughBreakout.reduce((sum, item) => sum + typical(item.candle) * (item.candle.volume ?? 0), 0) / volume; if (side === "LONG" ? breakout.candle.close <= vwap : breakout.candle.close >= vwap) continue; }
      setupCount++;
      let entryItem = breakout;
      if (definition.requireRetest) {
        const tolerance = definition.retestToleranceBps ?? 5, level = side === "LONG" ? rangeHigh : rangeLow;
        const retestCandidates = afterRange.slice(candidateIndex + 1, candidateIndex + 1 + (definition.retestMaxCandles ?? 6));
        const retest = retestCandidates.find(item => side === "LONG" ? item.candle.low <= level * (1 + tolerance / 10_000) && item.candle.high >= level * (1 - tolerance / 10_000) && item.candle.close > level : item.candle.high >= level * (1 - tolerance / 10_000) && item.candle.low <= level * (1 + tolerance / 10_000) && item.candle.close < level);
        if (!retest) break; entryItem = retest;
      }
      const entry = entryItem.candle.close, rawStop = side === "LONG" ? entryItem.candle.low : entryItem.candle.high;
      const stop = side === "LONG" ? rawStop * (1 - definition.stopBufferBps / 10_000) : rawStop * (1 + definition.stopBufferBps / 10_000), risk = Math.abs(entry - stop);
      if (!(risk > 0)) continue;
      const target = side === "LONG" ? entry + risk * (definition.targetR ?? 2) : entry - risk * (definition.targetR ?? 2);
      const path = indices.filter(item => item.index > entryItem.index);
      let exitItem = path.at(-1) ?? entryItem, exit = exitItem.candle.close, outcome: StrategyTrade["outcome"] = "TIME_EXIT", mfe = 0, mae = 0;
      for (const next of path) { mfe = Math.max(mfe, side === "LONG" ? next.candle.high - entry : entry - next.candle.low); mae = Math.max(mae, side === "LONG" ? entry - next.candle.low : next.candle.high - entry); const stopHit = side === "LONG" ? next.candle.low <= stop : next.candle.high >= stop, targetHit = side === "LONG" ? next.candle.high >= target : next.candle.low <= target; if (stopHit || targetHit) { outcome = stopHit ? "LOSS" : "WIN"; exit = stopHit ? stop : target; exitItem = next; break; } }
      const costs = entry * (definition.feeBps + definition.slippageBps) / 10_000, pnl = (side === "LONG" ? exit - entry : entry - exit) - costs;
      const rangePct = (rangeHigh - rangeLow) / Math.max(0.0000001, (rangeHigh + rangeLow) / 2) * 100, volatilityBucket = rangePct < 0.5 ? "LOW" : rangePct < 1.5 ? "MEDIUM" : "HIGH";
      trades.push({ tradeKey: deterministicDigest({ strategy: definition.strategyId, version: definition.version, breakout: breakout.candle.id, entry: entryItem.candle.id }), side, setupAt: breakout.candle.closedAt, enteredAt: entryItem.candle.closedAt, exitedAt: exitItem.candle.closedAt, entry, stop, target, exit, outcome, rMultiple: pnl / risk, mfeR: mfe / risk, maeR: -mae / risk, holdMinutes: Math.max(0, (Date.parse(exitItem.candle.closedAt) - Date.parse(entryItem.candle.closedAt)) / 60_000), evidenceRefs: [...range.map(item => item.candle.id), breakout.candle.id, entryItem.candle.id, exitItem.candle.id], session: entryItem.context.marketSession, weekday: entryItem.context.weekday, regime: regimeAt(entryItem.candle.closedAt), entryHour: entryItem.context.localExchangeTime.slice(0, 2), volatilityBucket });
      break;
    }
  }
  return { trades, setupCount };
}

function segmentPerformance(trades: StrategyTrade[], minimum: number) { const dimensions = ["weekday", "session", "regime", "side", "entryHour", "volatilityBucket"] as const; return dimensions.flatMap(dimension => [...new Set(trades.map(item => item[dimension]))].sort().map(value => { const group = trades.filter(item => item[dimension] === value), enough = group.length >= minimum; return { dimension, value, sampleSize: group.length, status: enough ? "AVAILABLE" : "INSUFFICIENT_DATA", winRate: enough ? group.filter(item => item.rMultiple > 0).length / group.length * 100 : null, averageR: enough ? group.reduce((sum, item) => sum + item.rMultiple, 0) / group.length : null }; })); }
function latestPriorReference(refs: Map<string, { high: number; low: number; ids: string[] }>, at: string) { const key = [...refs.keys()].filter(value => value < at.slice(0, 10)).sort().at(-1); return key ? { key, range: refs.get(key)! } : null; }
function sessionDate(at: string, timeZone: string) { const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at)).map(item => [item.type, item.value])); return `${values.year}-${values.month}-${values.day}`; }
function emaSeries(values: number[], period: number) { const result: Array<number | null> = values.map(() => null); if (values.length < period) return result; const multiplier = 2 / (period + 1); let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period; result[period - 1] = current; for (let index = period; index < values.length; index++) { current = (values[index] - current) * multiplier + current; result[index] = current; } return result; }
function typical(candle: MarketCandle) { return (candle.high + candle.low + candle.close) / 3; }
function validateDefinition(definition: StrategyDefinition) { if (definition.version < 1 || !definition.strategyId || definition.minimumSampleSize < 1) throw new Error("INVALID_STRATEGY_DEFINITION"); if (definition.stopBufferBps < 0 || definition.feeBps < 0 || definition.slippageBps < 0) throw new Error("INVALID_STRATEGY_COST_OR_RISK"); if (definition.setupType === "EMA_VWAP_MOMENTUM" && (!(definition.fastEmaPeriod && definition.slowEmaPeriod) || definition.fastEmaPeriod >= definition.slowEmaPeriod || definition.targetPolicy !== "FIXED_R")) throw new Error("INVALID_EMA_VWAP_DEFINITION"); if (definition.setupType === "OPENING_RANGE_BREAKOUT" && (!(definition.openingRangeMinutes && definition.openingRangeMinutes > 0) || definition.targetPolicy !== "FIXED_R" || !(definition.targetR && definition.targetR > 0) || (definition.entryCutoffMinutes ?? 0) <= definition.openingRangeMinutes)) throw new Error("INVALID_ORB_DEFINITION"); }

export const ASIA_NY_SWEEP_REVERSAL_V1: StrategyDefinition = { strategyId: "asia-ny-sweep-reversal", version: 1, name: "Asia / New York High-Low Sweep Reversal", market: "XAUUSD", timeframe: "5m", setupType: "SESSION_SWEEP_REVERSAL", exchangeTimeZone: "UTC", referenceSession: "NEW_YORK", allowedSession: "ASIA", sessionWindows: [
  { session: "ASIA", timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 17 * 60 },
  { session: "NEW_YORK", timeZone: "America/New_York", openMinute: 8 * 60, closeMinute: 17 * 60 },
], rejectionCloseInside: true, stopBufferBps: 2, targetPolicy: "OPPOSITE_REFERENCE_LEVEL", feeBps: 1, slippageBps: 2, minimumSampleSize: MIN_STRATEGY_SAMPLE_SIZE };

export const EMA_VWAP_MOMENTUM_V1: StrategyDefinition = { strategyId: "ema-vwap-momentum", version: 1, name: "EMA 9/20 + VWAP Momentum", market: "GENERIC", timeframe: "5m", setupType: "EMA_VWAP_MOMENTUM", exchangeTimeZone: "America/New_York", allowedSession: "REGULAR", sessionWindows: [{ session: "REGULAR", timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 }], rejectionCloseInside: false, stopBufferBps: 2, targetPolicy: "FIXED_R", targetR: 2, fastEmaPeriod: 9, slowEmaPeriod: 20, feeBps: 1, slippageBps: 2, minimumSampleSize: MIN_STRATEGY_SAMPLE_SIZE };

const US_REGULAR_SESSION: SessionWindow[] = [{ session: "REGULAR", timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 }];
const ORB_RETEST_BASE = {
  market: "US_STOCKS", timeframe: "5m", setupType: "OPENING_RANGE_BREAKOUT" as const,
  exchangeTimeZone: "America/New_York", allowedSession: "REGULAR" as const, sessionWindows: US_REGULAR_SESSION,
  rejectionCloseInside: false, stopBufferBps: 5, targetPolicy: "FIXED_R" as const, targetR: 2,
  breakoutConfirmation: "CLOSE" as const, requireRetest: true, retestToleranceBps: 10, retestMaxCandles: 6,
  entryCutoffMinutes: 60, minimumBreakoutVolumeMultiple: 1.5, requireVwapConfirmation: true,
  feeBps: 1, slippageBps: 2, minimumSampleSize: MIN_STRATEGY_SAMPLE_SIZE,
};
export const ORB_RETEST_5M_V1: StrategyDefinition = { ...ORB_RETEST_BASE, strategyId: "orb-retest-5m", version: 2, name: "Opening Range Breakout · 5m Retest", openingRangeMinutes: 5 };
export const ORB_RETEST_15M_V1: StrategyDefinition = { ...ORB_RETEST_BASE, strategyId: "orb-retest-15m", version: 2, name: "Opening Range Breakout · 15m Retest", openingRangeMinutes: 15 };
export const ORB_RETEST_30M_V1: StrategyDefinition = { ...ORB_RETEST_BASE, strategyId: "orb-retest-30m", version: 1, name: "Opening Range Breakout · 30m Retest", openingRangeMinutes: 30, entryCutoffMinutes: 120 };
export const ORB_DIRECT_15M_V1: StrategyDefinition = { ...ORB_RETEST_BASE, strategyId: "orb-direct-15m", version: 1, name: "Opening Range Breakout · 15m Direct", openingRangeMinutes: 15, requireRetest: false };

const EMA_VWAP_BASE = { ...EMA_VWAP_MOMENTUM_V1, version: 1 };
export const EMA_VWAP_FAST_V1: StrategyDefinition = { ...EMA_VWAP_BASE, strategyId: "ema-vwap-fast", name: "EMA 5/13 + VWAP Momentum", fastEmaPeriod: 5, slowEmaPeriod: 13 };
export const EMA_VWAP_SLOW_V1: StrategyDefinition = { ...EMA_VWAP_BASE, strategyId: "ema-vwap-slow", name: "EMA 20/50 + VWAP Trend", fastEmaPeriod: 20, slowEmaPeriod: 50 };

const SWEEP_BASE = { ...ASIA_NY_SWEEP_REVERSAL_V1, market: "XAUUSD" };
export const LONDON_PRIOR_NY_SWEEP_V1: StrategyDefinition = { ...SWEEP_BASE, strategyId: "london-prior-ny-sweep", name: "London / Prior New York Sweep Reversal", allowedSession: "LONDON", sessionWindows: [
  { session: "LONDON", timeZone: "Europe/London", openMinute: 8 * 60, closeMinute: 16 * 60 + 30 },
  { session: "NEW_YORK", timeZone: "America/New_York", openMinute: 8 * 60, closeMinute: 17 * 60 },
] };
export const NEW_YORK_PRIOR_ASIA_SWEEP_V1: StrategyDefinition = { ...SWEEP_BASE, strategyId: "new-york-prior-asia-sweep", name: "New York / Prior Asia Sweep Reversal", referenceSession: "ASIA", allowedSession: "NEW_YORK", sessionWindows: [
  { session: "ASIA", timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 17 * 60 },
  { session: "NEW_YORK", timeZone: "America/New_York", openMinute: 8 * 60, closeMinute: 17 * 60 },
] };

export const TOP_TEN_RESEARCH_STRATEGIES: readonly StrategyDefinition[] = [
  ORB_RETEST_15M_V1, ORB_RETEST_5M_V1, EMA_VWAP_MOMENTUM_V1, ASIA_NY_SWEEP_REVERSAL_V1, ORB_RETEST_30M_V1,
  ORB_DIRECT_15M_V1, EMA_VWAP_FAST_V1, EMA_VWAP_SLOW_V1, LONDON_PRIOR_NY_SWEEP_V1, NEW_YORK_PRIOR_ASIA_SWEEP_V1,
];

export const STRATEGY_RESEARCH_CATALOG = TOP_TEN_RESEARCH_STRATEGIES.map((definition, index) => ({
  definition,
  researchPriority: index + 1,
  researchStatus: "UNPROVEN" as const,
  rationale: [
    "15-minute opening range with volume, VWAP and retest confirmation.",
    "Fast opening-range variant to measure early signal versus noise.",
    "Short-term EMA crossover confirmed by session VWAP.",
    "Asia-session rejection after sweeping the prior New York range.",
    "Wider opening range intended to reduce false breaks.",
    "Direct-breakout control variant without retest confirmation.",
    "Faster EMA momentum variant for responsiveness testing.",
    "Slower EMA trend variant for turnover and noise testing.",
    "London-session rejection after sweeping the prior New York range.",
    "New York-session rejection after sweeping the prior Asia range.",
  ][index],
}));
