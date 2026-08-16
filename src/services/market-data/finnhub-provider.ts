import { z } from "zod";
import { MarketDataProvider, ProviderError, StockQuote } from "./provider";

const quoteSchema = z.object({
  c: z.number(), d: z.number().nullable().optional(), dp: z.number().nullable().optional(),
  h: z.number().nullable().optional(), l: z.number().nullable().optional(),
  o: z.number().nullable().optional(), pc: z.number().nullable().optional(), t: z.number(),
});

type Fetch = typeof fetch;

export class FinnhubProvider implements MarketDataProvider {
  readonly name = "finnhub";
  constructor(private readonly apiKey: string, private readonly fetcher: Fetch = fetch) {}

  async getQuotes(symbols: string[]): Promise<StockQuote[]> {
    const quotes: StockQuote[] = [];
    for (const symbol of symbols) quotes.push(await this.getQuote(symbol));
    return quotes;
  }

  private async getQuote(symbol: string): Promise<StockQuote> {
    let response: Response;
    try {
      response = await this.fetcher(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(this.apiKey)}`);
    } catch (error) {
      throw new ProviderError(`Finnhub network failure for ${symbol}: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true);
    }
    const remaining = parseNumberHeader(response.headers.get("x-ratelimit-remaining"));
    const resetAt = parseResetHeader(response.headers.get("x-ratelimit-reset"));
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw new ProviderError(`Finnhub rate limit reached while fetching ${symbol}`, this.name, "rate_limited", true, 429, retryAfterMs);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError("Finnhub API key was rejected", this.name, "unauthorized", false, response.status);
    if (!response.ok) throw new ProviderError(`Finnhub returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
    const parsed = quoteSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.c <= 0 || parsed.data.t <= 0) throw new ProviderError(`Finnhub returned an invalid quote for ${symbol}`, this.name, "invalid_response", false, response.status);
    const now = new Date().toISOString();
    return {
      symbol, price: parsed.data.c, open: parsed.data.o ?? null, high: parsed.data.h ?? null,
      low: parsed.data.l ?? null, previousClose: parsed.data.pc ?? null, change: parsed.data.d ?? null,
      changePercent: parsed.data.dp ?? null, volume: null,
      observedAt: new Date(parsed.data.t * 1000).toISOString(), receivedAt: now, provider: this.name,
      providerEventId: `${symbol}:${parsed.data.t}`, rateLimit: { remaining, resetAt },
    };
  }
}

function parseNumberHeader(value: string | null) { const parsed = value === null ? NaN : Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parseResetHeader(value: string | null) { const seconds = parseNumberHeader(value); return seconds === null ? null : new Date(seconds * 1000).toISOString(); }
function parseRetryAfter(value: string | null) { const seconds = parseNumberHeader(value); return seconds === null ? null : seconds * 1000; }

