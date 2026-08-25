import { describe, expect, it, vi } from "vitest";
import { BirdeyeLiveMarketProvider, rotatingSlice } from "../src/services/crypto-market/birdeye-live-provider";
import type { CryptoMarketDataProvider, CryptoMarketPoint } from "../src/services/crypto-market/provider";

function fallbackPoint(mintAddress: string): CryptoMarketPoint {
  return {
    chain: "solana", mintAddress, symbol: "TEST", name: "Test", priceUsd: 1, marketCapUsd: 10,
    circulatingSupply: null, liquidityUsd: 20, volume24hUsd: 30, poolAddress: "pool",
    observedAt: "2026-08-25T10:00:00.000Z", providerTimestamp: null, provider: "dexscreener",
    confidence: 100, completeness: "complete", rawPayload: { source: "fallback" },
  };
}

function fallback(): CryptoMarketDataProvider {
  return {
    name: "dexscreener",
    getCurrent: vi.fn(async (mints: string[]) => ({
      points: mints.map(fallbackPoint), rateLimit: { remaining: null, resetAt: null },
    })),
    getHistorical: vi.fn(async (request) => fallbackPoint(request.mintAddress)),
  };
}

describe("Birdeye live market provider", () => {
  it("prefers Birdeye values while preserving fallback pool and volume", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
      address: "mint", price: 2, liquidity: 40, market_cap: 80, circulating_supply: 12, holder: 5,
    } }), { status: 200 })) as typeof fetch;
    const provider = new BirdeyeLiveMarketProvider("key", fallback(), fetcher, {
      maxTokensPerRun: 8, now: () => new Date("2026-08-25T10:00:00.000Z"),
    });

    const result = await provider.getCurrent(["mint"]);

    expect(result.points[0]).toMatchObject({
      provider: "birdeye-live-composite-v1", priceUsd: 2, liquidityUsd: 40,
      marketCapUsd: 80, circulatingSupply: 12, volume24hUsd: 30, poolAddress: "pool",
    });
  });

  it("preserves fallback truth when a Birdeye request fails", async () => {
    const fetcher = vi.fn(async () => new Response("failure", { status: 500 })) as typeof fetch;
    const provider = new BirdeyeLiveMarketProvider("key", fallback(), fetcher);
    const result = await provider.getCurrent(["mint"]);
    expect(result.points[0]).toEqual(fallbackPoint("mint"));
  });

  it("bounds and rotates Birdeye calls deterministically", async () => {
    const mints = Array.from({ length: 12 }, (_, index) => `mint-${index}`);
    const first = rotatingSlice(mints, 3, new Date(0));
    const second = rotatingSlice(mints, 3, new Date(120_000));
    expect(first).toEqual(["mint-0", "mint-1", "mint-2"]);
    expect(second).toEqual(["mint-3", "mint-4", "mint-5"]);
  });
});
