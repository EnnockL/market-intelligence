import { z } from "zod";
import { ProviderError } from "@/services/market-data/provider";
import { timeframeSeconds, type CandleBatch, type CandleRequest, type HistoricalCandleProvider, type ProviderCandle } from "./provider";
import { fetchWithRetry, type FetchRetryOptions } from "@/services/providers/fetch-with-retry";

const schema = z.object({ s: z.enum(["ok", "no_data"]), t: z.array(z.number()).optional(), o: z.array(z.number()).optional(), h: z.array(z.number()).optional(), l: z.array(z.number()).optional(), c: z.array(z.number()).optional(), v: z.array(z.number().nullable()).optional() });
export class FinnhubCandleProvider implements HistoricalCandleProvider {
  readonly name = "finnhub-candles";
  constructor(private apiKey: string, private fetcher: typeof fetch = fetch, private baseUrl = "https://finnhub.io/api/v1", private retryOptions: FetchRetryOptions = {}) {}
  async getCandles(request: CandleRequest): Promise<CandleBatch> {
    if (request.instrumentKind === "CRYPTO_POOL") throw new ProviderError("Finnhub provider does not support pool candles", this.name, "invalid_response", false);
    const resolution = resolutionFor(request.timeframe), from = Math.floor(Date.parse(request.cursor ?? request.startsAt) / 1000), to = Math.floor(Date.parse(request.endsAt) / 1000);
    const path = request.instrumentKind === "FOREX" ? "forex/candle" : "stock/candle";
    const response = await fetchWithRetry(() => this.fetcher(`${this.baseUrl}/${path}?symbol=${encodeURIComponent(request.providerSymbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${encodeURIComponent(this.apiKey)}`), this.retryOptions);
    if (response.status === 429) throw new ProviderError("Finnhub candle rate limit reached", this.name, "rate_limited", true, 429, retryMs(response.headers.get("retry-after")));
    if (response.status === 401 || response.status === 403) throw new ProviderError("Finnhub candle entitlement or API key rejected", this.name, "unauthorized", false, response.status);
    if (!response.ok) throw new ProviderError(`Finnhub candles returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
    const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new ProviderError("Finnhub returned invalid candle data", this.name, "invalid_response", false);
    if (parsed.data.s === "no_data") return { candles: [], nextCursor: null, rateLimit: headers(response) };
    const values = parsed.data, count = Math.min(values.t?.length ?? 0, values.o?.length ?? 0, values.h?.length ?? 0, values.l?.length ?? 0, values.c?.length ?? 0), duration = timeframeSeconds(request.timeframe), observedAt = new Date().toISOString();
    const candles: ProviderCandle[] = Array.from({ length: count }, (_, index) => { const openedAt = new Date(values.t![index] * 1000).toISOString(); const closedAt = new Date((values.t![index] + duration) * 1000).toISOString(); return { id: `${this.name}:${request.providerSymbol}:${request.timeframe}:${values.t![index]}`, assetId: request.assetId, provider: this.name, timeframe: request.timeframe, openedAt, closedAt, observedAt, availableAt: closedAt, open: values.o![index], high: values.h![index], low: values.l![index], close: values.c![index], volume: values.v?.[index] ?? null, dataQuality: values.v?.[index] === null || values.v?.[index] === undefined ? 85 : 95, rawPayload: { symbol: request.providerSymbol, timestamp: values.t![index] } }; });
    const bounded = candles.filter(item => item.closedAt <= request.endsAt).slice(0, request.limit ?? 500), last = bounded.at(-1);
    return { candles: bounded, nextCursor: last && candles.length > bounded.length ? new Date(Date.parse(last.openedAt) + duration * 1000).toISOString() : null, rateLimit: headers(response) };
  }
}
function resolutionFor(timeframe: string) { const map: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "1d": "D" }; const value = map[timeframe]; if (!value) throw new Error(`UNSUPPORTED_FINNHUB_TIMEFRAME:${timeframe}`); return value; }
function retryMs(value: string | null) { const seconds = Number(value); return Number.isFinite(seconds) ? seconds * 1000 : null; }
function headers(response: Response) { const remaining = Number(response.headers.get("x-ratelimit-remaining")), reset = Number(response.headers.get("x-ratelimit-reset")); return { remaining: Number.isFinite(remaining) ? remaining : null, resetAt: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null }; }
