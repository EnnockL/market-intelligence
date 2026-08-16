import type { WalletTransactionSide } from "@/domain/database";
import type { ProviderRateLimit } from "@/services/market-data/provider";

export interface NormalizedWalletTransaction {
  walletAddress: string; signature: string; instructionIndex: number; mintAddress: string | null;
  side: WalletTransactionSide; quantity: number | null; nativeValueSol: number | null;
  slot: number; occurredAt: string; receivedAt: string; rawPayload: unknown;
}

export interface WalletTransactionBatch {
  transactions: NormalizedWalletTransaction[]; newestSignature: string | null; rateLimit: ProviderRateLimit;
}

export interface BlockchainDataProvider {
  readonly chain: string; readonly name: string;
  getWalletTransactions(address: string, untilSignature?: string): Promise<WalletTransactionBatch>;
}

