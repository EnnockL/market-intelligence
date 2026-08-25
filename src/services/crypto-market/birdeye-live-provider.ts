import { z } from "zod";
import { ProviderError } from "../market-data/provider";
import type {
  CryptoMarketBatch,
  CryptoMarketDataProvider,
  CryptoMarketPoint,
  HistoricalPriceRequest,
} from "./provider";

const responseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    address: z.string(),
    price: z.number().nullable().optional(),
    liquidity: z.number().nullable().optional(),
    total_supply: z.number().nullable().optional(),
    circulating_supply: z.number().nullable().optional(),
    fdv: z.number().nullable().optional(),
    market_cap: z.number().nullable().optional(),
    holder: z.number().nullable().optional(),
  }).passthrough(),
});

type Fetch = typeof fetch;

export interface BirdeyeLiveOptions {
  maxTokensPerRun?: number;
  now?: () => Date;
}

/**
 * A quota-aware Birdeye live overlay. Birdeye is authoritative for fields it
 * returns; the fallback supplies symbols, pools and 24h volume and covers
 * tokens outside the rotating Birdeye budget.
 */
export class BirdeyeLiveMarketProvider implements CryptoMarketDataProvider {
  readonly name = "birdeye-live-composite-v1";
  private readonly maxTokensPerRun: number;
  private readonly now: () => Date;

  constructor(
    private readonly apiKey: string,
    private readonly fallback: CryptoMarketDataProvider,
    private readonly fetcher: Fetch = fetch,
    options: BirdeyeLiveOptions = {},
  ) {
    this.maxTokensPerRun = Math.max(1, Math.min(10, options.maxTokensPerRun ?? 8));
    this.now = options.now ?? (() => new Date());
  }

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    if (!mintAddresses.length) return { points: [], rateLimit: { remaining: null, resetAt: null } };

    // DexScreener remains the bulk transport so all configured assets receive
    // observations. Birdeye rotates across the set in deterministic 2-minute
    // windows, keeping Lite usage bounded while enriching every token over time.
    const fallbackBatch = await this.fallback.getCurrent(mintAddresses);
    const fallbackByMint = new Map(fallbackBatch.points.map((point) => [point.mintAddress, point]));
    const selected = rotatingSlice(mintAddresses, this.maxTokensPerRun, this.now());
    const overlays = new Map<string, CryptoMarketPoint>();

    for (const mintAddress of selected) {
      try {
        overlays.set(mintAddress, await this.fetchOne(mintAddress, fallbackByMint.get(mintAddress)));
      } catch (error) {
        if (error instanceof ProviderError && error.code === "rate_limited") break;
        // A per-token provider failure must not discard the valid bulk fallback.
      }
    }

    return {
      points: mintAddresses.map((mint) => overlays.get(mint) ?? fallbackByMint.get(mint)!).filter(Boolean),
      rateLimit: fallbackBatch.rateLimit,
    };
  }

  getHistorical(request: HistoricalPriceRequest) {
    return this.fallback.getHistorical(request);
  }

  private async fetchOne(mintAddress: string, fallback?: CryptoMarketPoint): Promise<CryptoMarketPoint> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://public-api.birdeye.so/defi/v3/token/market-data?address=${encodeURIComponent(mintAddress)}`,
        { headers: { "X-API-KEY": this.apiKey, "x-chain": "solana" } },
      );
    } catch (error) {
      throw new ProviderError(`Birdeye network failure: ${error instanceof Error ? error.message : "unknown error"}`, this.name, "unavailable", true);
    }
    if (response.status === 429) {
      throw new ProviderError("Birdeye rate limit reached", this.name, "rate_limited", true, 429, retryAfter(response.headers.get("retry-after")));
    }
    if (!response.ok) {
      throw new ProviderError(`Birdeye returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.success) {
      throw new ProviderError("Birdeye returned an invalid payload", this.name, "invalid_response", false);
    }

    const data = parsed.data.data;
    const priceUsd = finite(data.price) ?? fallback?.priceUsd ?? null;
    const liquidityUsd = finite(data.liquidity) ?? fallback?.liquidityUsd ?? null;
    const marketCapUsd = finite(data.market_cap) ?? finite(data.fdv) ?? fallback?.marketCapUsd ?? null;
    const circulatingSupply = finite(data.circulating_supply) ?? finite(data.total_supply) ?? fallback?.circulatingSupply ?? null;
    const volume24hUsd = fallback?.volume24hUsd ?? null;
    const available = [priceUsd, liquidityUsd, marketCapUsd, volume24hUsd].filter((value) => value !== null).length;
    const observedAt = this.now().toISOString();

    return {
      chain: "solana",
      mintAddress,
      symbol: fallback?.symbol ?? null,
      name: fallback?.name ?? null,
      priceUsd,
      marketCapUsd,
      circulatingSupply,
      liquidityUsd,
      volume24hUsd,
      poolAddress: fallback?.poolAddress ?? null,
      observedAt,
      providerTimestamp: null,
      provider: this.name,
      confidence: Math.round((available / 4) * 100),
      completeness: available === 4 ? "complete" : available ? "partial" : "unavailable",
      rawPayload: { birdeye: data, fallback: fallback?.rawPayload ?? null },
    };
  }
}

export function rotatingSlice(values: string[], limit: number, now: Date): string[] {
  if (values.length <= limit) return [...values];
  const bucket = Math.floor(now.getTime() / 120_000);
  const start = (bucket * limit) % values.length;
  return Array.from({ length: limit }, (_, index) => values[(start + index) % values.length]);
}

function finite(value: unknown) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
}

function retryAfter(value: string | null) {
  const seconds = finite(value);
  return seconds === null ? null : seconds * 1_000;
}
