import { z } from "zod";
import { ProviderError } from "../market-data/provider";
import { unavailableHistorical, type CryptoMarketBatch, type CryptoMarketDataProvider, type HistoricalPriceRequest } from "./provider";

const responseSchema = z.object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])) }) }), meta: z.unknown().optional() });
type Fetch = typeof fetch;
export class CoinGeckoHistoricalProvider implements CryptoMarketDataProvider {
  readonly name = "coingecko-onchain";
  constructor(private readonly apiKey: string, private readonly fetcher: Fetch = fetch, private readonly baseUrl = "https://pro-api.coingecko.com/api/v3") {}
  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    return { points: mintAddresses.map((mint) => unavailableHistorical(mint, new Date().toISOString(), this.name, { reason: "current_data_delegated_to_dexscreener" })), rateLimit: { remaining: null, resetAt: null } };
  }
  async getHistorical(request: HistoricalPriceRequest) {
    const target = Math.floor(new Date(request.timestamp).getTime() / 1000);
    const url = `${this.baseUrl}/onchain/networks/solana/tokens/${request.mintAddress}/ohlcv/minute?aggregate=1&before_timestamp=${target + 60}&limit=2&currency=usd`;
    let response: Response;
    try { response = await this.fetcher(url, { headers: { "x-cg-pro-api-key": this.apiKey } }); }
    catch (error) { throw new ProviderError(`CoinGecko network failure: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true); }
    if (response.status === 429) throw new ProviderError("CoinGecko rate limit reached", this.name, "rate_limited", true, 429);
    if (!response.ok) throw new ProviderError(`CoinGecko returned HTTP ${response.status}`, this.name, response.status === 401 ? "unauthorized" : "unavailable", response.status >= 500, response.status);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("CoinGecko returned an invalid OHLCV payload", this.name, "invalid_response", false);
    const candle = parsed.data.data.attributes.ohlcv_list.filter((item) => item[0] <= target).sort((a, b) => b[0] - a[0])[0];
    if (!candle) return unavailableHistorical(request.mintAddress, request.timestamp, this.name, parsed.data);
    const distanceSeconds = Math.abs(target - candle[0]);
    return { chain: "solana" as const, mintAddress: request.mintAddress, symbol: null, name: null, priceUsd: candle[4],
      marketCapUsd: null, circulatingSupply: null, liquidityUsd: null, volume24hUsd: null, poolAddress: null,
      observedAt: new Date().toISOString(), providerTimestamp: new Date(candle[0] * 1000).toISOString(), provider: this.name,
      confidence: distanceSeconds <= 120 ? 85 : 40, completeness: "partial" as const, rawPayload: { candle, distanceSeconds } };
  }
}
