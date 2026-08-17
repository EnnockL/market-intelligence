import { describe, expect, it, vi } from "vitest";
import { FreeCryptoMarketProvider } from "../src/services/crypto-market/free-market-provider";
import type { CryptoMarketDataProvider, CryptoMarketPoint } from "../src/services/crypto-market/provider";

const point = (provider: string, liquidityUsd: number | null, poolAddress: string | null): CryptoMarketPoint => ({
  chain: "solana", mintAddress: "mint", symbol: null, name: null, priceUsd: 1, marketCapUsd: null,
  circulatingSupply: null, liquidityUsd, volume24hUsd: null, poolAddress, observedAt: "2026-08-17T10:00:00Z",
  providerTimestamp: null, provider, confidence: 50, completeness: "partial", rawPayload: {},
});
const provider = (value: CryptoMarketPoint): CryptoMarketDataProvider => ({ name: value.provider,
  getCurrent: vi.fn(async () => ({ points: [value], rateLimit: { remaining: null, resetAt: null } })),
  getHistorical: vi.fn(async () => value) });

describe("free market provider", () => {
  it("uses the fallback only when primary liquidity is unavailable", async () => {
    const primary = provider(point("dexscreener", null, "dex-pool")); const fallback = provider(point("geckoterminal", 42_000, "gecko-pool"));
    const result = await new FreeCryptoMarketProvider(primary, fallback).getCurrent(["mint"]);
    expect(result.points[0]).toMatchObject({ provider: "geckoterminal", liquidityUsd: 42_000, poolAddress: "gecko-pool" });
    expect(fallback.getCurrent).toHaveBeenCalledOnce();
  });
});
