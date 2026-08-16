import { describe, expect, it, vi } from "vitest";
import { DexScreenerProvider } from "../src/services/crypto-market/dexscreener-provider";
import { CoinGeckoHistoricalProvider } from "../src/services/crypto-market/coingecko-provider";

describe("crypto market providers", () => {
  it("selects the most liquid DEX pair and preserves null fields", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { chainId: "solana", pairAddress: "small", baseToken: { address: mint, name: "Wrapped SOL", symbol: "SOL" }, quoteToken: { address: "USD", symbol: "USDC" }, priceUsd: "75", liquidity: { usd: 100 }, marketCap: null, volume: { h24: 20 } },
      { chainId: "solana", pairAddress: "large", baseToken: { address: mint, name: "Wrapped SOL", symbol: "SOL" }, quoteToken: { address: "USD", symbol: "USDC" }, priceUsd: "76", liquidity: { usd: 1000 }, marketCap: 4000, volume: { h24: 500 } },
    ]), { status: 200 }));
    const result = await new DexScreenerProvider(fetcher).getCurrent([mint]);
    expect(result.points[0]).toMatchObject({ mintAddress: mint, priceUsd: 76, liquidityUsd: 1000, poolAddress: "large", provider: "dexscreener" });
    expect(result.points[0].circulatingSupply).toBeNull();
  });

  it("returns unavailable rather than inventing unsupported DEX history", async () => {
    const result = await new DexScreenerProvider().getHistorical({ mintAddress: "Mint111111111111111111111111111111111111", timestamp: "2026-08-16T10:00:00Z" });
    expect(result).toMatchObject({ priceUsd: null, completeness: "unavailable", confidence: 0 });
  });

  it("selects the closest historical candle before the transaction", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[1786874340, 1, 3, 1, 2.5, 100]] } } }), { status: 200 }));
    const result = await new CoinGeckoHistoricalProvider("test-key", fetcher).getHistorical({ mintAddress: "Mint111111111111111111111111111111111111", timestamp: "2026-08-16T10:00:00Z" });
    expect(result.priceUsd).toBe(2.5); expect(result.providerTimestamp).toBe("2026-08-16T09:59:00.000Z"); expect(result.confidence).toBe(85);
  });

  it("surfaces provider rate limits as retryable failures", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "2" } }));
    await expect(new DexScreenerProvider(fetcher).getCurrent(["So11111111111111111111111111111111111111112"]))
      .rejects.toMatchObject({ code: "rate_limited", retryable: true, status: 429, retryAfterMs: 2000 });
  });
});
