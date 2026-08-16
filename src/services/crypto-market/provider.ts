import type { ProviderRateLimit } from "@/services/market-data/provider";

export type MarketDataCompleteness = "complete" | "partial" | "unavailable";
export interface CryptoMarketPoint {
  chain: "solana"; mintAddress: string; symbol: string | null; name: string | null;
  priceUsd: number | null; marketCapUsd: number | null; circulatingSupply: number | null;
  liquidityUsd: number | null; volume24hUsd: number | null; poolAddress: string | null;
  observedAt: string; providerTimestamp: string | null; provider: string;
  confidence: number; completeness: MarketDataCompleteness; rawPayload: unknown;
}
export interface HistoricalPriceRequest { mintAddress: string; timestamp: string; }
export interface CryptoMarketBatch { points: CryptoMarketPoint[]; rateLimit: ProviderRateLimit; }

export interface CryptoMarketDataProvider {
  readonly name: string;
  getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch>;
  getHistorical(request: HistoricalPriceRequest): Promise<CryptoMarketPoint>;
}

export function unavailableHistorical(mintAddress: string, timestamp: string, provider: string, rawPayload: unknown = null): CryptoMarketPoint {
  return { chain: "solana", mintAddress, symbol: null, name: null, priceUsd: null, marketCapUsd: null,
    circulatingSupply: null, liquidityUsd: null, volume24hUsd: null, poolAddress: null,
    observedAt: new Date().toISOString(), providerTimestamp: timestamp, provider, confidence: 0,
    completeness: "unavailable", rawPayload };
}
