import { describe, expect, it, vi } from "vitest";
import { GeckoTerminalPoolDiscoveryProvider } from "@/services/pool-discovery/geckoterminal-provider";
import { DexScreenerPoolDiscoveryProvider } from "@/services/pool-discovery/dexscreener-provider";
import { CompositePoolDiscoveryProvider } from "@/services/pool-discovery/composite-provider";

const headers = new Headers({ "content-type": "application/json" });
describe("pool discovery providers", () => {
  it("normalizes GeckoTerminal new pools with point-in-time identity", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "solana_pool1", attributes: { address: "pool1", name: "ALPHA / SOL", pool_created_at: "2026-08-24T10:00:00Z", base_token_price_usd: "0.02", reserve_in_usd: "75000", market_cap_usd: "1000000", volume_usd: { h24: "200000" } }, relationships: { base_token: { data: { id: "solana_MintAlpha" } } } }] }), { status: 200, headers })) as typeof fetch;
    const result = await new GeckoTerminalPoolDiscoveryProvider(fetcher).discover({ limit: 5, cutoff: "2026-08-25T00:00:00Z" });
    expect(result.pools[0]).toMatchObject({ mintAddress: "MintAlpha", poolAddress: "pool1", liquidityUsd: 75000, poolCreatedAt: "2026-08-24T10:00:00.000Z", dataQuality: 100 });
  });

  it("normalizes bounded DexScreener profile discovery", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("token-profiles")
      ? new Response(JSON.stringify([{ chainId: "solana", tokenAddress: "MintBeta" }, { chainId: "ethereum", tokenAddress: "ignore" }]), { status: 200, headers })
      : new Response(JSON.stringify([{ chainId: "solana", pairAddress: "pair-beta", pairCreatedAt: 1787558400000, baseToken: { address: "MintBeta", symbol: "BETA", name: "Beta" }, priceUsd: "1.2", liquidity: { usd: 90000 }, volume: { h24: 300000 }, marketCap: 2000000 }]), { status: 200, headers })) as typeof fetch;
    const result = await new DexScreenerPoolDiscoveryProvider(fetcher).discover({ limit: 2, cutoff: "2026-08-25T00:00:00Z" });
    expect(result.pools).toHaveLength(1);
    expect(result.pools[0]).toMatchObject({ mintAddress: "MintBeta", poolAddress: "pair-beta", liquidityUsd: 90000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("deduplicates provider overlap deterministically by quality", async () => {
    const low = { name: "low", discover: vi.fn(async () => ({ pools: [pool(40, "low")], rateLimit: { remaining: null, resetAt: null } })) };
    const high = { name: "high", discover: vi.fn(async () => ({ pools: [pool(90, "high")], rateLimit: { remaining: null, resetAt: null } })) };
    const result = await new CompositePoolDiscoveryProvider([low, high]).discover({ limit: 10, cutoff: "2026-08-25T00:00:00Z" });
    expect(result.pools).toHaveLength(1);
    expect(result.pools[0].provider).toBe("high");
  });

  it("degrades to the healthy provider", async () => {
    const failed = { name: "failed", discover: vi.fn(async () => { throw new Error("rate limited"); }) };
    const healthy = { name: "healthy", discover: vi.fn(async () => ({ pools: [pool(80, "healthy")], rateLimit: { remaining: null, resetAt: null } })) };
    const result = await new CompositePoolDiscoveryProvider([failed, healthy]).discover({ limit: 10, cutoff: "2026-08-25T00:00:00Z" });
    expect(result.pools[0].provider).toBe("healthy");
    expect(result.providerErrors).toEqual([{ provider: "failed", message: "rate limited", retryable: false }]);
  });

  it("surfaces rate limits as retryable provider failures", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 429, headers })) as typeof fetch;
    await expect(new DexScreenerPoolDiscoveryProvider(fetcher).discover({ limit: 2, cutoff: "2026-08-25T00:00:00Z" }))
      .rejects.toMatchObject({ code: "rate_limited", retryable: true, status: 429 });
  });
});

function pool(dataQuality: number, provider: string) { return { chain: "solana" as const, mintAddress: "mint", poolAddress: "pool", symbol: null, name: null, priceUsd: 1, liquidityUsd: 1, volume24hUsd: 1, marketCapUsd: 1, poolCreatedAt: null, observedAt: "2026-08-25T00:00:00.000Z", availableAt: "2026-08-25T00:00:00.000Z", provider, sourceReference: `${provider}:pool`, confidence: dataQuality, dataQuality, rawPayload: {} }; }
