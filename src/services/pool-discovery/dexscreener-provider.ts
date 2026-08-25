import { z } from "zod";
import { ProviderError } from "@/services/market-data/provider";
import type { DiscoveredPool, PoolDiscoveryBatch, PoolDiscoveryProvider } from "./provider";

const profileSchema = z.object({ chainId: z.string(), tokenAddress: z.string() }).passthrough();
const pairSchema = z.object({
  chainId: z.string(), pairAddress: z.string().optional(), pairCreatedAt: z.number().nullable().optional(),
  baseToken: z.object({ address: z.string(), symbol: z.string().optional(), name: z.string().optional() }),
  priceUsd: z.string().nullable().optional(), liquidity: z.object({ usd: z.number().nullable().optional() }).nullable().optional(),
  volume: z.object({ h24: z.number().nullable().optional() }).passthrough().optional(), marketCap: z.number().nullable().optional(),
}).passthrough();

export class DexScreenerPoolDiscoveryProvider implements PoolDiscoveryProvider {
  readonly name = "dexscreener-token-profiles";
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly baseUrl = "https://api.dexscreener.com") {}

  async discover(input: { limit: number; cutoff: string }): Promise<PoolDiscoveryBatch> {
    const profileResponse = await this.request(`${this.baseUrl}/token-profiles/latest/v1`);
    const profiles = z.array(profileSchema).safeParse(await profileResponse.json());
    if (!profiles.success) throw new ProviderError("DEX Screener returned invalid token profiles", this.name, "invalid_response", false);
    const mints = [...new Set(profiles.data.filter((x) => x.chainId === "solana").map((x) => x.tokenAddress))].slice(0, Math.max(1, Math.min(10, input.limit)));
    if (!mints.length) return { pools: [], rateLimit: { remaining: null, resetAt: null } };
    const pairResponse = await this.request(`${this.baseUrl}/tokens/v1/solana/${mints.join(",")}`);
    const pairs = z.array(pairSchema).safeParse(await pairResponse.json());
    if (!pairs.success) throw new ProviderError("DEX Screener returned invalid discovery pairs", this.name, "invalid_response", false);
    const availableAt = new Date().toISOString();
    const pools = mints.flatMap((mint) => {
      const pair = pairs.data.filter((x) => x.chainId === "solana" && x.baseToken.address === mint).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      return pair ? [mapPair(pair, availableAt, this.name)] : [];
    });
    return { pools, rateLimit: { remaining: numberOrNull(pairResponse.headers.get("x-ratelimit-remaining")), resetAt: null } };
  }

  private async request(url: string) {
    let response: Response;
    try { response = await this.fetcher(url, { headers: { accept: "application/json" } }); }
    catch (cause) { throw new ProviderError(`DEX Screener discovery network failure: ${cause instanceof Error ? cause.message : "unknown"}`, this.name, "unavailable", true); }
    if (response.status === 429) throw new ProviderError("DEX Screener discovery rate limit reached", this.name, "rate_limited", true, 429);
    if (!response.ok) throw new ProviderError(`DEX Screener discovery returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
    return response;
  }
}

function mapPair(pair: z.infer<typeof pairSchema>, availableAt: string, provider: string): DiscoveredPool {
  const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null;
  const observedAt = createdAt && createdAt <= availableAt ? createdAt : availableAt;
  const values = [finite(pair.priceUsd), finite(pair.liquidity?.usd), finite(pair.volume?.h24), finite(pair.marketCap)];
  const populated = values.filter((x) => x !== null).length;
  return { chain: "solana", mintAddress: pair.baseToken.address, poolAddress: pair.pairAddress ?? null, symbol: pair.baseToken.symbol ?? null,
    name: pair.baseToken.name ?? null, priceUsd: values[0], liquidityUsd: values[1], volume24hUsd: values[2], marketCapUsd: values[3],
    poolCreatedAt: createdAt, observedAt, availableAt, provider, sourceReference: `dexscreener:solana:${pair.pairAddress ?? pair.baseToken.address}`,
    confidence: createdAt ? 85 : 70, dataQuality: Math.round((populated / 4) * 70 + (createdAt ? 20 : 0) + 10), rawPayload: pair };
}
function finite(value: unknown) { const n = Number(value); return value !== null && value !== undefined && Number.isFinite(n) ? n : null; }
function numberOrNull(value: string | null) { return finite(value); }

