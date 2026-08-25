import type { WalletTransactionSide } from "@/domain/database";
import type { ProviderRateLimit } from "@/services/market-data/provider";

export interface NormalizedWalletTransaction {
  walletAddress: string; signature: string; instructionIndex: number; mintAddress: string | null;
  tokenDecimals: number | null;
  side: WalletTransactionSide; quantity: number | null; nativeValueSol: number | null;
  slot: number; occurredAt: string; receivedAt: string; rawPayload: unknown;
}

export interface WalletTransactionBatch {
  transactions: NormalizedWalletTransaction[]; newestSignature: string | null; oldestSignature: string | null;
  hasMore: boolean; requestsUsed: number; rateLimit: ProviderRateLimit;
}
export interface WalletHistoryRequest { untilSignature?: string; beforeSignature?: string; limit?: number; maxRequests?: number; }

export interface WalletDiscoveryCandidate {
  address: string; score: number; dataQuality: number; observedTransactions: number;
  successfulTransactions: number; activeDays: number; sourceAddresses: string[];
  reasons: string[]; riskFlags: string[]; observedAt: string;
}

export interface BlockchainDataProvider {
  readonly chain: string; readonly name: string;
  getWalletTransactions(address: string, request?: WalletHistoryRequest): Promise<WalletTransactionBatch>;
  discoverWalletCandidates(seedAddresses: string[]): Promise<WalletDiscoveryCandidate[]>;
}
