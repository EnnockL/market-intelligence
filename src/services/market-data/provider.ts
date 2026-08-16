export interface ProviderRateLimit {
  remaining: number | null;
  resetAt: string | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: "unauthorized" | "rate_limited" | "invalid_response" | "unavailable",
    public readonly retryable: boolean,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
  ) { super(message); this.name = "ProviderError"; }
}

export interface StockQuote {
  symbol: string; price: number; open: number | null; high: number | null; low: number | null;
  previousClose: number | null; change: number | null; changePercent: number | null;
  volume: number | null; observedAt: string; receivedAt: string; provider: string;
  providerEventId: string; rateLimit: ProviderRateLimit;
}

export interface MarketDataProvider {
  readonly name: string;
  getQuotes(symbols: string[]): Promise<StockQuote[]>;
}

