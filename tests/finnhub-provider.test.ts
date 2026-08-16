import { describe, expect, it } from "vitest";
import { FinnhubProvider } from "../src/services/market-data/finnhub-provider";
import { ProviderError } from "../src/services/market-data/provider";

describe("FinnhubProvider", () => {
  it("normalizes a quote with provider and observation timestamps", async () => {
    const fetcher = async () => new Response(JSON.stringify({ c: 226.05, d: 1.2, dp: 0.53, h: 228, l: 223, o: 224, pc: 224.85, t: 1786903200 }), { status: 200, headers: { "x-ratelimit-remaining": "57" } });
    const [quote] = await new FinnhubProvider("test", fetcher as typeof fetch).getQuotes(["AAPL"]);
    expect(quote).toMatchObject({ symbol: "AAPL", price: 226.05, provider: "finnhub", providerEventId: "AAPL:1786903200" });
    expect(quote.rateLimit.remaining).toBe(57);
    expect(new Date(quote.observedAt).toISOString()).toBe(quote.observedAt);
  });

  it("returns a retryable typed error on rate limiting", async () => {
    const fetcher = async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } });
    const promise = new FinnhubProvider("test", fetcher as typeof fetch).getQuotes(["AMD"]);
    await expect(promise).rejects.toMatchObject({ code: "rate_limited", retryable: true, retryAfterMs: 30000 } satisfies Partial<ProviderError>);
  });

  it("does not classify an invalid API key as retryable", async () => {
    const fetcher = async () => new Response("{}", { status: 401 });
    await expect(new FinnhubProvider("bad", fetcher as typeof fetch).getQuotes(["NVDA"])).rejects.toMatchObject({ code: "unauthorized", retryable: false });
  });
});
