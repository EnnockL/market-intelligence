import { z } from "zod";
import { ProviderError } from "../market-data/provider";
import {
  unavailableHistorical,
  type CryptoMarketBatch,
  type CryptoMarketDataProvider,
  type CryptoMarketPoint,
  type HistoricalPriceRequest,
} from "./provider";

const responseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      address: z.string().optional(),
      updateUnixTime: z.number().optional(),
      value: z.number().nullable().optional(),
    })
    .nullable(),
});

type Fetch = typeof fetch;

export class BirdeyeHistoricalPriceProvider
  implements CryptoMarketDataProvider
{
  readonly name = "birdeye-historical-price-unix-v1";
  private readonly cache = new Map<string, CryptoMarketPoint>();

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetch = fetch,
    private readonly baseUrl = "https://public-api.birdeye.so",
  ) {}

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    const observedAt = new Date().toISOString();
    return {
      points: mintAddresses.map((mint) =>
        unavailableHistorical(mint, observedAt, this.name, {
          reason: "CURRENT_DATA_DELEGATED",
        }),
      ),
      rateLimit: { remaining: null, resetAt: null },
    };
  }

  async getHistorical(request: HistoricalPriceRequest) {
    const target = Math.floor(new Date(request.timestamp).getTime() / 1000);
    if (!Number.isFinite(target)) {
      throw new ProviderError(
        "Birdeye historical price received an invalid timestamp",
        this.name,
        "unavailable",
        false,
      );
    }
    const cacheKey = `${request.mintAddress}:${target}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/defi/historical_price_unix`);
    url.searchParams.set("address", request.mintAddress);
    url.searchParams.set("unixtime", String(target));
    const response = await this.request(url);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        "Birdeye returned an invalid historical price payload",
        this.name,
        "invalid_response",
        false,
      );
    }

    const value = parsed.data.data?.value;
    const providerUnix = parsed.data.data?.updateUnixTime ?? target;
    const distanceSeconds = Math.abs(target - providerUnix);
    const point =
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? {
            chain: "solana" as const,
            mintAddress: request.mintAddress,
            symbol: null,
            name: null,
            priceUsd: value,
            marketCapUsd: null,
            circulatingSupply: null,
            liquidityUsd: null,
            volume24hUsd: null,
            poolAddress: null,
            observedAt: new Date().toISOString(),
            providerTimestamp: new Date(providerUnix * 1000).toISOString(),
            provider: this.name,
            confidence: distanceSeconds <= 60 ? 95 : distanceSeconds <= 300 ? 80 : 50,
            completeness: "partial" as const,
            rawPayload: { ...parsed.data.data, requestedUnixTime: target, distanceSeconds },
          }
        : unavailableHistorical(
            request.mintAddress,
            request.timestamp,
            this.name,
            { reason: "HISTORICAL_PRICE_UNAVAILABLE", response: parsed.data },
          );
    this.cache.set(cacheKey, point);
    return point;
  }

  private async request(url: URL) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": this.apiKey,
          },
        });
      } catch (error) {
        throw new ProviderError(
          `Birdeye network failure: ${error instanceof Error ? error.message : "unknown error"}`,
          this.name,
          "unavailable",
          true,
        );
      }
      if (response.status === 429 && attempt < 3) {
        await delay(retryMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (response.status === 429)
        throw new ProviderError(
          "Birdeye historical price rate limit reached",
          this.name,
          "rate_limited",
          true,
          429,
        );
      if (response.status === 401 || response.status === 403)
        throw new ProviderError(
          "Birdeye historical price authorization failed",
          this.name,
          "unauthorized",
          false,
          response.status,
        );
      if (!response.ok)
        throw new ProviderError(
          `Birdeye historical price HTTP ${response.status}`,
          this.name,
          "unavailable",
          response.status >= 500,
          response.status,
        );
      return response;
    }
    throw new ProviderError(
      "Birdeye historical price retry limit reached",
      this.name,
      "rate_limited",
      true,
      429,
    );
  }
}

function retryMs(value: string | null, attempt: number) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : Math.min(1000 * 2 ** attempt, 8000);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
