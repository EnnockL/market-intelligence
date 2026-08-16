import type { AssetKind, SignalDirection } from "./market";

export type UUID = string;
export type ISODateTime = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Asset {
  id: UUID; kind: AssetKind; symbol: string; name: string; externalId: string | null;
  isActive: boolean; metadata: Json; createdAt: ISODateTime; updatedAt: ISODateTime;
}

export interface Stock {
  assetId: UUID; exchange: string; currency: string; cik: string | null;
  sector: string | null; industry: string | null;
}

export interface CryptoToken {
  assetId: UUID; chain: string; mintAddress: string; decimals: number;
  firstSeenAt: ISODateTime | null; mintAuthority: string | null; freezeAuthority: string | null;
}

export interface Wallet {
  id: UUID; chain: string; address: string; label: string | null;
  isTracked: boolean; firstSeenAt: ISODateTime | null; createdAt: ISODateTime;
}

export type WalletTransactionSide = "buy" | "sell" | "transfer" | "other";

export interface WalletTransaction {
  id: UUID; walletId: UUID; assetId: UUID | null; transactionHash: string;
  instructionIndex: number; side: WalletTransactionSide | null; quantity: string | null;
  priceUsd: string | null; valueUsd: string | null; blockNumber: number | null;
  occurredAt: ISODateTime; rawPayload: Json; ingestedAt: ISODateTime;
}

export type SignalStatus = "active" | "expired" | "invalidated";

export interface Signal {
  id: UUID; assetId: UUID; direction: SignalDirection; opportunityScore: number;
  riskScore: number; confidence: number | null; scoringVersion: string; thesis: string | null;
  observedPriceUsd: string | null; generatedAt: ISODateTime; expiresAt: ISODateTime | null;
  status: SignalStatus;
}

export interface Watchlist {
  id: UUID; userId: UUID; name: string; isDefault: boolean;
  createdAt: ISODateTime; updatedAt: ISODateTime;
}

export interface WatchlistItem {
  watchlistId: UUID; assetId: UUID; note: string | null; createdAt: ISODateTime;
}

