import type { MarketCandle } from "@/domain/technical-structure";

export type CandleInstrumentKind = "STOCK" | "FOREX" | "CRYPTO_POOL";
export interface CandleRequest { assetId: string; instrumentKind: CandleInstrumentKind; providerSymbol: string; timeframe: string; startsAt: string; endsAt: string; cursor?: string | null; limit?: number; tokenSide?: "base" | "quote"; }
export interface ProviderCandle extends MarketCandle { provider: string; observedAt: string; dataQuality: number; rawPayload: unknown; }
export interface CandleBatch { candles: ProviderCandle[]; nextCursor: string | null; rateLimit: { remaining: number | null; resetAt: string | null }; }
export interface HistoricalCandleProvider { readonly name: string; getCandles(request: CandleRequest): Promise<CandleBatch>; }

export function timeframeSeconds(timeframe: string) { const match = /^(\d+)(m|h|d)$/.exec(timeframe); if (!match) throw new Error(`UNSUPPORTED_TIMEFRAME:${timeframe}`); const unit = match[2] === "m" ? 60 : match[2] === "h" ? 3600 : 86400; return Number(match[1]) * unit; }
export function stableCandleKey(candle: Pick<ProviderCandle, "assetId" | "provider" | "timeframe" | "openedAt">) { return `${candle.assetId}:${candle.provider}:${candle.timeframe}:${candle.openedAt}`; }
