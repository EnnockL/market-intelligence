import { z } from "zod";
import { ProviderError } from "../market-data/provider";
import { unavailableHistorical, type CryptoMarketBatch, type CryptoMarketDataProvider, type CryptoMarketPoint, type HistoricalPriceRequest } from "./provider";

const tokenSchema = z.object({
  chainId: z.string().optional(), dexId: z.string().optional(), pairAddress: z.string().optional(),
  baseToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }).optional(),
  quoteToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }).optional(),
  priceUsd: z.string().nullable().optional(), liquidity: z.object({ usd: z.number().nullable().optional() }).nullable().optional(),
  marketCap: z.number().nullable().optional(), volume: z.object({ h24: z.number().nullable().optional() }).passthrough().optional(),
  pairCreatedAt: z.number().nullable().optional(),
}).passthrough();

type Fetch = typeof fetch;
export class DexScreenerProvider implements CryptoMarketDataProvider {
  readonly name = "dexscreener";
  constructor(private readonly fetcher: Fetch = fetch) {}

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    const points: CryptoMarketPoint[] = [];
    for (let index = 0; index < mintAddresses.length; index += 30) {
      const mints = mintAddresses.slice(index, index + 30);
      let response: Response;
      try { response = await this.fetcher(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`); }
      catch (error) { throw new ProviderError(`DEX Screener network failure: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true); }
      if (response.status === 429) throw new ProviderError("DEX Screener rate limit reached", this.name, "rate_limited", true, 429, retryAfter(response.headers.get("retry-after")));
      if (!response.ok) throw new ProviderError(`DEX Screener returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
      const parsed = z.array(tokenSchema).safeParse(await response.json());
      if (!parsed.success) throw new ProviderError("DEX Screener returned an invalid payload", this.name, "invalid_response", false);
      for (const mintAddress of mints) {
        const pairs = parsed.data.filter((pair) => pair.chainId === "solana" && (pair.baseToken?.address === mintAddress || pair.quoteToken?.address === mintAddress));
        const pair = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        if (pair) points.push(mapPair(pair, mintAddress));
        else points.push(unavailableHistorical(mintAddress, new Date().toISOString(), this.name, []));
      }
      const remaining = numericHeader(response.headers.get("x-ratelimit-remaining"));
      if (index + 30 >= mintAddresses.length) return { points, rateLimit: { remaining, resetAt: null } };
    }
    return { points, rateLimit: { remaining: null, resetAt: null } };
  }

  async getHistorical(request: HistoricalPriceRequest) {
    return unavailableHistorical(request.mintAddress, request.timestamp, this.name, { reason: "historical_price_not_supported" });
  }
}

function mapPair(pair: z.infer<typeof tokenSchema>, mintAddress: string): CryptoMarketPoint {
  const token = pair.baseToken?.address === mintAddress ? pair.baseToken : pair.quoteToken;
  const priceUsd = finite(pair.priceUsd); const liquidityUsd = finite(pair.liquidity?.usd);
  const available = [priceUsd, liquidityUsd, finite(pair.marketCap), finite(pair.volume?.h24)].filter((value) => value !== null).length;
  return { chain: "solana", mintAddress, symbol: token?.symbol ?? null, name: token?.name ?? null,
    priceUsd, marketCapUsd: finite(pair.marketCap), circulatingSupply: null, liquidityUsd,
    volume24hUsd: finite(pair.volume?.h24), poolAddress: pair.pairAddress ?? null,
    observedAt: new Date().toISOString(), providerTimestamp: null, provider: "dexscreener",
    confidence: Math.round(available / 4 * 100), completeness: available === 4 ? "complete" : "partial", rawPayload: pair };
}
function finite(value: unknown) { const parsed = Number(value); return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null; }
function numericHeader(value: string | null) { return finite(value); }
function retryAfter(value: string | null) { const seconds = numericHeader(value); return seconds === null ? null : seconds * 1000; }
