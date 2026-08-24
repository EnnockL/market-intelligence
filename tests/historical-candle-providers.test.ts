import { describe, expect, it, vi } from "vitest";
import { FinnhubCandleProvider } from "../src/services/candles/finnhub-candle-provider";
import { GeckoTerminalCandleProvider } from "../src/services/candles/geckoterminal-candle-provider";
import { ProviderError } from "../src/services/market-data/provider";
import { stableCandleKey, timeframeSeconds } from "../src/services/candles/provider";

const start = "2026-08-24T12:00:00.000Z", end = "2026-08-24T13:00:00.000Z", timestamp = Date.parse(start) / 1000;
describe("historical candle providers v1", () => {
  it("normalizes Finnhub OHLCV and preserves point-in-time availability", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ s: "ok", t: [timestamp], o: [10], h: [12], l: [9], c: [11], v: [100] }), { status: 200, headers: { "x-ratelimit-remaining": "59" } }));
    const result = await new FinnhubCandleProvider("key", fetcher as typeof fetch).getCandles({ assetId: "asset", instrumentKind: "STOCK", providerSymbol: "AAPL", timeframe: "5m", startsAt: start, endsAt: end });
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]).toMatchObject({ open: 10, high: 12, low: 9, close: 11, volume: 100 });
    expect(result.candles[0].availableAt).toBe(result.candles[0].closedAt);
    expect(result.rateLimit.remaining).toBe(59);
  });
  it("classifies Finnhub entitlement and rate limits", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }));
    await expect(new FinnhubCandleProvider("key", fetcher as typeof fetch).getCandles({ assetId: "asset", instrumentKind: "FOREX", providerSymbol: "OANDA:XAU_USD", timeframe: "5m", startsAt: start, endsAt: end })).rejects.toMatchObject({ code: "rate_limited", retryable: true, retryAfterMs: 2000 } satisfies Partial<ProviderError>);
  });
  it("normalizes GeckoTerminal pool candles", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[timestamp, 10, 12, 9, 11, 500]] } } }), { status: 200 }));
    const result = await new GeckoTerminalCandleProvider(fetcher as typeof fetch).getCandles({ assetId: "asset", instrumentKind: "CRYPTO_POOL", providerSymbol: "pool", tokenSide: "base", timeframe: "5m", startsAt: start, endsAt: end });
    expect(result.candles[0].provider).toBe("geckoterminal-ohlcv");
    expect(result.candles[0].volume).toBe(500);
  });
  it("creates stable idempotency keys and validates timeframes", () => {
    expect(stableCandleKey({ assetId: "a", provider: "p", timeframe: "5m", openedAt: start })).toBe(`a:p:5m:${start}`);
    expect(timeframeSeconds("4h")).toBe(14_400);
    expect(() => timeframeSeconds("weekly")).toThrow("UNSUPPORTED_TIMEFRAME");
  });
});
