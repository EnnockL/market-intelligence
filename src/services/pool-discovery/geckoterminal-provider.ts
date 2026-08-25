import { z } from "zod";
import { ProviderError } from "@/services/market-data/provider";
import type { DiscoveredPool, PoolDiscoveryBatch, PoolDiscoveryProvider } from "./provider";

const poolSchema = z.object({
  id: z.string(),
  attributes: z.object({
    address: z.string(), name: z.string().nullable().optional(), pool_created_at: z.string().nullable().optional(),
    base_token_price_usd: z.string().nullable().optional(), reserve_in_usd: z.string().nullable().optional(),
    market_cap_usd: z.string().nullable().optional(), volume_usd: z.object({ h24: z.string().nullable().optional() }).passthrough().optional(),
  }).passthrough(),
  relationships: z.object({ base_token: z.object({ data: z.object({ id: z.string() }) }) }),
}).passthrough();
const responseSchema = z.object({ data: z.array(poolSchema) });

export class GeckoTerminalPoolDiscoveryProvider implements PoolDiscoveryProvider {
  readonly name = "geckoterminal-new-pools";
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly baseUrl = "https://api.geckoterminal.com/api/v2") {}

  async discover(input: { limit: number; cutoff: string }): Promise<PoolDiscoveryBatch> {
    const response = await requestWithRetry(this.fetcher, `${this.baseUrl}/networks/solana/new_pools?page=1`, this.name);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("GeckoTerminal returned invalid new-pools data", this.name, "invalid_response", false);
    const availableAt = new Date().toISOString();
    const pools = parsed.data.data.slice(0, bounded(input.limit)).map((pool) => mapPool(pool, availableAt, this.name));
    return { pools, rateLimit: { remaining: numberOrNull(response.headers.get("x-ratelimit-remaining")), resetAt: null } };
  }
}

function mapPool(pool: z.infer<typeof poolSchema>, availableAt: string, provider: string): DiscoveredPool {
  const mintAddress = relationshipAddress(pool.relationships.base_token.data.id);
  const createdAt = validDate(pool.attributes.pool_created_at);
  const observedAt = createdAt && createdAt <= availableAt ? createdAt : availableAt;
  const values = [finite(pool.attributes.base_token_price_usd), finite(pool.attributes.reserve_in_usd), finite(pool.attributes.volume_usd?.h24), finite(pool.attributes.market_cap_usd)];
  const populated = values.filter((value) => value !== null).length;
  return { chain: "solana", mintAddress, poolAddress: pool.attributes.address, symbol: tokenSymbol(pool.attributes.name), name: pool.attributes.name ?? null,
    priceUsd: values[0], liquidityUsd: values[1], volume24hUsd: values[2], marketCapUsd: values[3], poolCreatedAt: createdAt,
    observedAt, availableAt, provider, sourceReference: `geckoterminal:solana:${pool.attributes.address}`,
    confidence: createdAt ? 90 : 75, dataQuality: Math.round((populated / 4) * 70 + (createdAt ? 20 : 0) + 10), rawPayload: pool };
}

function relationshipAddress(value: string) { const prefix = "solana_"; return value.startsWith(prefix) ? value.slice(prefix.length) : value.split("_").at(-1)!; }
function tokenSymbol(name?: string | null) { return name?.split(/[\/\s-]+/).find(Boolean)?.slice(0, 20) ?? null; }
function finite(value: unknown) { const n = Number(value); return value !== null && value !== undefined && Number.isFinite(n) ? n : null; }
function numberOrNull(value: string | null) { return finite(value); }
function validDate(value?: string | null) { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function bounded(value: number) { return Math.max(1, Math.min(20, Math.floor(value))); }
async function requestWithRetry(fetcher: typeof fetch, url: string, provider: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try { response = await fetcher(url, { headers: { accept: "application/json;version=20230302" } }); }
    catch (cause) { throw new ProviderError(`GeckoTerminal discovery network failure: ${cause instanceof Error ? cause.message : "unknown"}`, provider, "unavailable", true); }
    if (response.status !== 429) {
      if (!response.ok) throw new ProviderError(`GeckoTerminal discovery returned HTTP ${response.status}`, provider, "unavailable", response.status >= 500, response.status);
      return response;
    }
    if (attempt === 3) throw new ProviderError("GeckoTerminal discovery rate limit reached", provider, "rate_limited", true, 429);
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 4_000)));
  }
  throw new ProviderError("GeckoTerminal discovery unavailable", provider, "unavailable", true);
}

