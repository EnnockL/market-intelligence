import { z } from "zod";
import { ProviderError } from "../market-data/provider";
import { unavailableHistorical, type CryptoMarketBatch, type CryptoMarketDataProvider, type CryptoMarketPoint, type HistoricalPriceRequest } from "./provider";

const poolSchema = z.object({
  id: z.string(), attributes: z.object({ address: z.string(), name: z.string().optional(),
    base_token_price_usd: z.string().nullable().optional(), quote_token_price_usd: z.string().nullable().optional(),
    reserve_in_usd: z.string().nullable().optional(), market_cap_usd: z.string().nullable().optional(),
    volume_usd: z.object({ h24: z.string().nullable().optional() }).passthrough().optional() }).passthrough(),
  relationships: z.object({ base_token: z.object({ data: z.object({ id: z.string() }) }), quote_token: z.object({ data: z.object({ id: z.string() }) }) }),
});
const poolsSchema = z.object({ data: z.array(poolSchema) });
const ohlcvSchema = z.object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])) }) }) });
type Fetch = typeof fetch;

export class GeckoTerminalProvider implements CryptoMarketDataProvider {
  readonly name = "geckoterminal-public";
  constructor(private readonly fetcher: Fetch = fetch, private readonly baseUrl = "https://api.geckoterminal.com/api/v2") {}

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    const points: CryptoMarketPoint[] = [];
    for (const mint of mintAddresses) { const pool = await this.topPool(mint); points.push(pool ? currentPoint(pool, mint, this.name) : unavailableHistorical(mint, new Date().toISOString(), this.name)); }
    return { points, rateLimit: { remaining: null, resetAt: null } };
  }

  async getHistorical(request: HistoricalPriceRequest): Promise<CryptoMarketPoint> {
    const pool = await this.topPool(request.mintAddress);
    if (!pool) return unavailableHistorical(request.mintAddress, request.timestamp, this.name, { reason: "no_pool_found" });
    const target = Math.floor(new Date(request.timestamp).getTime() / 1000);
    const tokenSide = pool.relationships.base_token.data.id.endsWith(`_${request.mintAddress}`) ? "base" : "quote";
    const response = await this.request(`${this.baseUrl}/networks/solana/pools/${pool.attributes.address}/ohlcv/minute?aggregate=1&before_timestamp=${target + 60}&limit=2&currency=usd&token=${tokenSide}`);
    const parsed = ohlcvSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("GeckoTerminal returned an invalid OHLCV payload", this.name, "invalid_response", false);
    const candle = parsed.data.data.attributes.ohlcv_list.filter((item) => item[0] <= target).sort((a, b) => b[0] - a[0])[0];
    if (!candle) return unavailableHistorical(request.mintAddress, request.timestamp, this.name, { pool: pool.attributes.address, reason: "no_candle_before_timestamp" });
    const distanceSeconds = target - candle[0];
    return { chain: "solana", mintAddress: request.mintAddress, symbol: null, name: null, priceUsd: candle[4],
      marketCapUsd: null, circulatingSupply: null, liquidityUsd: null, volume24hUsd: null, poolAddress: pool.attributes.address,
      observedAt: new Date().toISOString(), providerTimestamp: new Date(candle[0] * 1000).toISOString(), provider: this.name,
      confidence: distanceSeconds <= 120 ? 80 : distanceSeconds <= 900 ? 55 : 25, completeness: "partial",
      rawPayload: { candle, poolAddress: pool.attributes.address, tokenSide, distanceSeconds, historicalLiquidityUnavailable: true } };
  }

  private async topPool(mint: string) {
    const response = await this.request(`${this.baseUrl}/networks/solana/tokens/${mint}/pools?page=1`);
    const parsed = poolsSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("GeckoTerminal returned an invalid pools payload", this.name, "invalid_response", false);
    return [...parsed.data.data].sort((a, b) => (finite(b.attributes.reserve_in_usd) ?? 0) - (finite(a.attributes.reserve_in_usd) ?? 0))[0] ?? null;
  }

  private async request(url: string) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response: Response;
      try { response = await this.fetcher(url, { headers: { accept: "application/json;version=20230302" } }); }
      catch (error) { throw new ProviderError(`GeckoTerminal network failure: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true); }
      if (response.status === 429 && attempt < 5) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1_000
          : Math.min(1_000 * 2 ** attempt, 15_000);
        await delay(waitMs);
        continue;
      }
      if (response.status === 429) throw new ProviderError("GeckoTerminal public rate limit reached", this.name, "rate_limited", true, 429);
      if (!response.ok) throw new ProviderError(`GeckoTerminal returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
      return response;
    }
    throw new ProviderError("GeckoTerminal retry limit reached", this.name, "rate_limited", true, 429);
  }
}

function currentPoint(pool: z.infer<typeof poolSchema>, mint: string, provider: string): CryptoMarketPoint {
  const base = pool.relationships.base_token.data.id.endsWith(`_${mint}`); const priceUsd = finite(base ? pool.attributes.base_token_price_usd : pool.attributes.quote_token_price_usd);
  const available = [priceUsd, finite(pool.attributes.reserve_in_usd), finite(pool.attributes.market_cap_usd), finite(pool.attributes.volume_usd?.h24)].filter((item) => item !== null).length;
  return { chain: "solana", mintAddress: mint, symbol: null, name: null, priceUsd, marketCapUsd: finite(pool.attributes.market_cap_usd),
    circulatingSupply: null, liquidityUsd: finite(pool.attributes.reserve_in_usd), volume24hUsd: finite(pool.attributes.volume_usd?.h24),
    poolAddress: pool.attributes.address, observedAt: new Date().toISOString(), providerTimestamp: null, provider,
    confidence: Math.round(available / 4 * 100), completeness: available === 4 ? "complete" : "partial", rawPayload: pool };
}
function finite(value: unknown) { const result = Number(value); return value !== null && value !== undefined && Number.isFinite(result) ? result : null; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
