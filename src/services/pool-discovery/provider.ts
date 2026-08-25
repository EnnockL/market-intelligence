import type { ProviderRateLimit } from "@/services/market-data/provider";

export interface DiscoveredPool {
  chain: "solana";
  mintAddress: string;
  poolAddress: string | null;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  poolCreatedAt: string | null;
  observedAt: string;
  availableAt: string;
  provider: string;
  sourceReference: string;
  confidence: number;
  dataQuality: number;
  rawPayload: unknown;
}

export interface PoolDiscoveryBatch {
  pools: DiscoveredPool[];
  rateLimit: ProviderRateLimit;
  providerErrors?: Array<{ provider: string; message: string; retryable: boolean }>;
}

export interface PoolDiscoveryProvider {
  readonly name: string;
  discover(input: { limit: number; cutoff: string }): Promise<PoolDiscoveryBatch>;
}
