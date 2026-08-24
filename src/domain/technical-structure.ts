import { deterministicDigest } from "./events";
import { marketTimeContext, type SessionWindow } from "./market-time";

export const TECHNICAL_STRUCTURE_VERSION = "technical-structure-v1";
export type KnownState = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
export interface MarketCandle { id: string; assetId: string; timeframe: string; openedAt: string; closedAt: string; availableAt: string; open: number; high: number; low: number; close: number; volume: number | null; }
export interface TechnicalStructureInput { assetId: string; timeframe: string; cutoffAt: string; exchangeTimeZone: string; candles: MarketCandle[]; sessionWindows?: SessionWindow[]; }

export function analyzeTechnicalStructure(input: TechnicalStructureInput) {
  const candles = input.candles.filter(candle => candle.assetId === input.assetId && candle.timeframe === input.timeframe && candle.closedAt <= input.cutoffAt && candle.availableAt <= input.cutoffAt).sort(orderCandles);
  const latest = candles.at(-1), closes = candles.map(item => item.close), ema9 = ema(closes, 9), ema20 = ema(closes, 20);
  const volumeCandles = candles.filter(item => item.volume !== null && item.volume >= 0);
  const vwap = volumeCandles.length ? volumeCandles.reduce((sum, item) => sum + ((item.high + item.low + item.close) / 3) * item.volume!, 0) / Math.max(1, volumeCandles.reduce((sum, item) => sum + item.volume!, 0)) : null;
  const prior = candles.slice(-21, -1), resistance = prior.length ? Math.max(...prior.map(item => item.high)) : null, support = prior.length ? Math.min(...prior.map(item => item.low)) : null;
  const currentTime = marketTimeContext(input.cutoffAt, input.exchangeTimeZone, input.sessionWindows);
  const sessionZone = input.sessionWindows?.find(window => window.session === currentTime.marketSession)?.timeZone ?? input.exchangeTimeZone;
  const currentSessionDate = localDate(input.cutoffAt, sessionZone);
  const sessionCandles = candles.filter(item => marketTimeContext(item.closedAt, input.exchangeTimeZone, input.sessionWindows).marketSession === currentTime.marketSession && localDate(item.closedAt, sessionZone) === currentSessionDate);
  const previousDay = previousUtcDay(candles, input.cutoffAt);
  const enough = candles.length >= 20;
  const trendState: KnownState = !enough || ema9 === null || ema20 === null ? "UNKNOWN" : ema9 > ema20 ? "BULLISH" : ema9 < ema20 ? "BEARISH" : "NEUTRAL";
  const sweep = !latest || support === null || resistance === null ? "UNKNOWN" : latest.high > resistance && latest.close <= resistance ? "HIGH_SWEEP_REJECTION" : latest.low < support && latest.close >= support ? "LOW_SWEEP_REJECTION" : "NONE";
  const result = {
    version: TECHNICAL_STRUCTURE_VERSION, assetId: input.assetId, timeframe: input.timeframe, analysisCutoffAt: input.cutoffAt,
    trendState, supportLevels: support === null ? [] : [support], resistanceLevels: resistance === null ? [] : [resistance],
    openingRange: range(sessionCandles.slice(0, 3)), sessionHigh: maximum(sessionCandles, "high"), sessionLow: minimum(sessionCandles, "low"),
    previousDayHigh: maximum(previousDay, "high"), previousDayLow: minimum(previousDay, "low"),
    vwap, vwapState: !latest || vwap === null ? "UNKNOWN" : latest.close > vwap ? "ABOVE" : latest.close < vwap ? "BELOW" : "AT",
    ema9, ema20, breakoutState: !latest || support === null || resistance === null ? "UNKNOWN" : latest.close > resistance ? "UP" : latest.close < support ? "DOWN" : "NONE",
    retestState: "UNKNOWN", liquiditySweepState: sweep, marketStructureState: structure(candles), volatilityState: volatility(candles),
    evidenceRefs: candles.map(item => item.id), dataQuality: Math.min(100, Math.round(candles.length / 50 * 100)), status: enough ? "AVAILABLE" : "INSUFFICIENT_DATA",
  };
  return { ...result, analysisHash: deterministicDigest(result) };
}

function ema(values: number[], period: number) { if (values.length < period) return null; const multiplier = 2 / (period + 1); let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period; for (const current of values.slice(period)) value = (current - value) * multiplier + value; return value; }
function structure(candles: MarketCandle[]) { const recent = candles.slice(-4); if (recent.length < 4) return "UNKNOWN"; const highs = recent.map(x => x.high), lows = recent.map(x => x.low); return highs[3] > highs[1] && lows[2] > lows[0] ? "HIGHER_HIGHS_HIGHER_LOWS" : highs[3] < highs[1] && lows[2] < lows[0] ? "LOWER_HIGHS_LOWER_LOWS" : "RANGE"; }
function volatility(candles: MarketCandle[]) { if (candles.length < 20) return "UNKNOWN"; const ranges = candles.map(x => x.high - x.low), recent = avg(ranges.slice(-5)), base = avg(ranges.slice(-20, -5)); return recent > base * 1.5 ? "EXPANDING" : recent < base * 0.67 ? "CONTRACTING" : "NORMAL"; }
function previousUtcDay(candles: MarketCandle[], cutoff: string) { const day = new Date(Date.parse(cutoff) - 86_400_000).toISOString().slice(0, 10); return candles.filter(item => item.openedAt.slice(0, 10) === day); }
function range(items: MarketCandle[]) { return items.length ? { high: maximum(items, "high"), low: minimum(items, "low") } : null; }
function maximum(items: MarketCandle[], key: "high" | "low") { return items.length ? Math.max(...items.map(item => item[key])) : null; }
function minimum(items: MarketCandle[], key: "high" | "low") { return items.length ? Math.min(...items.map(item => item[key])) : null; }
function avg(values: number[]) { return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }
function orderCandles(a: MarketCandle, b: MarketCandle) { return a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id); }
function localDate(at: string, timeZone: string) { const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at)).map(item => [item.type, item.value])); return `${values.year}-${values.month}-${values.day}`; }
