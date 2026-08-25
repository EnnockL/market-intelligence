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
    expect(result.points[0]).toMatchObject({ provider: "dexscreener", liquidityUsd: 42_000, poolAddress: "dex-pool" });
    expect(fallback.getCurrent).toHaveBeenCalledOnce();
  });

  it("preserves primary observations when the optional fallback is unavailable", async () => {
    const primaryPoint = point("dexscreener", null, "dex-pool");
    const primary = provider(primaryPoint);
    const fallback = provider(point("geckoterminal", 42_000, "gecko-pool"));
    vi.mocked(fallback.getCurrent).mockRejectedValueOnce(new Error("rate limited"));

    const result = await new FreeCryptoMarketProvider(primary, fallback).getCurrent(["mint"]);

    expect(result.points).toEqual([primaryPoint]);
    expect(result.points[0].liquidityUsd).toBeNull();
  });

  it("bounds public fallback work per ingestion run", async () => {
    const mints = Array.from({ length: 12 }, (_, index) => `mint-${index}`);
    const primary = provider(point("dexscreener", null, null));
    vi.mocked(primary.getCurrent).mockResolvedValueOnce({
      points: mints.map((mintAddress) => ({ ...point("dexscreener", null, null), mintAddress })),
      rateLimit: { remaining: null, resetAt: null },
    });
    const fallback = provider(point("geckoterminal", 42_000, "gecko-pool"));
    vi.mocked(fallback.getCurrent).mockImplementationOnce(async (requested) => ({
      points: requested.map((mintAddress) => ({ ...point("geckoterminal", 42_000, "gecko-pool"), mintAddress })),
      rateLimit: { remaining: null, resetAt: null },
    }));

    await new FreeCryptoMarketProvider(primary, fallback).getCurrent(mints);

    expect(fallback.getCurrent).toHaveBeenCalledWith(mints.slice(0, 5));
  });
});
