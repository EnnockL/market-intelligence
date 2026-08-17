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

export type IngestionStatus = "running" | "succeeded" | "failed";
export type IngestionJobKind = "stock_quotes" | "wallet_transactions" | "wallet_discovery" | "crypto_market" | "wallet_pnl" | "wallet_evidence";

export type WalletDiscoveryStatus = "candidate" | "reviewing" | "verified" | "rejected";
export interface WalletDiscoveryCandidateRecord {
  id: UUID; chain: string; address: string; provider: string; status: WalletDiscoveryStatus;
  score: number; dataQuality: number; observedTransactions: number; successfulTransactions: number;
  activeDays: number; sourceAddresses: string[]; reasons: string[]; riskFlags: string[];
  firstObservedAt: ISODateTime; lastObservedAt: ISODateTime; reviewedAt: ISODateTime | null;
  createdAt: ISODateTime; updatedAt: ISODateTime;
}

export interface IngestionRun {
  id: UUID; jobKind: IngestionJobKind; provider: string; status: IngestionStatus;
  recordsProcessed: number; errorCode: string | null; errorMessage: string | null;
  startedAt: ISODateTime; finishedAt: ISODateTime | null;
}

export interface ProviderErrorRecord {
  id: UUID; ingestionRunId: UUID | null; provider: string; errorCode: string;
  message: string; retryable: boolean; httpStatus: number | null; context: Json; occurredAt: ISODateTime;
}

export type DataCompleteness = "complete" | "partial" | "unavailable";
export interface CryptoMarketObservation {
  id: UUID; assetId: UUID; provider: string; observedAt: ISODateTime; providerTimestamp: ISODateTime | null;
  priceUsd: string | null; marketCapUsd: string | null; circulatingSupply: string | null;
  liquidityUsd: string | null; volume24hUsd: string | null; poolAddress: string | null;
  confidence: number; completeness: DataCompleteness; rawPayload: Json; ingestedAt: ISODateTime;
}
export interface WalletTransactionEnrichment {
  id: UUID; walletTransactionId: UUID; provider: string; enrichmentVersion: string;
  status: "complete" | "partial" | "incomplete"; tokenPriceUsd: string | null; solPriceUsd: string | null;
  estimatedValueUsd: string | null; feeUsd: string | null; priorityFeeUsd: string | null;
  liquidityUsd: string | null; marketCapUsd: string | null; priceTimestamp: ISODateTime | null;
  knownAt: ISODateTime; pricingCompleteness: number; executionCompleteness: number; rawPayload: Json;
  informationCompleteness: number; priorityFeeStatus: string;
}
export interface WalletTradeCycleRecord {
  id: UUID; walletId: UUID; assetId: UUID; cycleNumber: number; engineVersion: string;
  status: "open" | "closed" | "incomplete"; quantity: string; investedUsd: string | null;
  costBasisUsd: string | null; averageEntryUsd: string | null; proceedsUsd: string | null;
  realizedPnlUsd: string | null; unrealizedPnlUsd: string | null; returnPercent: string | null;
  firstEntryAt: ISODateTime; finalExitAt: ISODateTime | null; holdingSeconds: number | null;
  pricingCompleteness: number; transactionCompleteness: number; executionCompleteness: number; dataQuality: number;
  informationCompleteness: number;
  walletScoreAtEntry: number | null; scoringVersionAtEntry: string | null; tokenRiskScoreAtEntry: number | null; entryContext: Json;
}
export interface WalletMetricSnapshot {
  id: UUID; walletId: UUID; engineVersion: string; scoringVersion: string; calculatedAt: ISODateTime;
  informationAvailableThrough: ISODateTime; closedTrades: number; verifiedTrades: number; wins: number; losses: number;
  winRate: string | null; medianReturn: string | null; meanReturn: string | null; realizedPnlUsd: string | null;
  bestTradePercent: string | null; worstTradePercent: string | null; medianHoldingSeconds: number | null; dataQuality: number; metrics: Json;
  maxDrawdown: string | null; rugExposureRate: string | null; rugAssessedTrades: number; riskDataQuality: number;
}
export interface TokenRiskObservation {
  id: UUID; assetId: UUID; provider: string; modelVersion: string; classification: "clear" | "watch" | "rug_confirmed" | "unknown";
  confidence: number; evidence: Json; observedAt: ISODateTime; knownAt: ISODateTime;
}
export interface CryptoLiquiditySnapshot {
  id: UUID; assetId: UUID; poolAddress: string; liquidityUsd: string; provider: string; selectionVersion: string;
  observedAt: ISODateTime; effectiveAt: ISODateTime; informationAvailableAt: ISODateTime; dataQuality: number; rawPayload: Json;
}
export interface WalletVerificationEvaluation {
  id: UUID; walletId: UUID; policyVersion: string; evaluatedAt: ISODateTime; dataSnapshotCutoff: ISODateTime;
  currentStatus: string; eligibleStatus: "candidate" | "reviewing" | "verified"; requirementsPassed: Json; requirementsFailed: Json; evidence: Json;
}
export interface EventOutboxRecord {
  id: UUID; eventId: string; eventType: string; schemaVersion: number; entityType: string; entityId: string;
  assetId: UUID | null; walletId: UUID | null; occurredAt: ISODateTime; observedAt: ISODateTime; availableAt: ISODateTime;
  provider: string; sourceReference: string; dataQuality: number; confidence: number | null; payload: Json; payloadHash: string;
  correlationId: string | null; causationId: string | null; status: "pending" | "processing" | "processed" | "failed";
  attempts: number; nextAttemptAt: ISODateTime; lockedAt: ISODateTime | null; lockedBy: string | null;
  processedAt: ISODateTime | null; lastError: string | null; createdAt: ISODateTime;
}
export interface OpportunityRecord {
  id: UUID; opportunityKey: string; assetId: UUID; opportunityType: string; policyVersion: string;
  currentState: "detected" | "fast_opportunity" | "enriching" | "qualified" | "watch" | "rejected" | "paper_trade_candidate";
  detectedAt: ISODateTime; lastEvidenceAt: ISODateTime; opportunityScore: number; riskScore: number | null;
  dataQuality: number; currentRevision: number; createdFromEventId: string; updatedAt: ISODateTime;
}
export interface OpportunityRevisionRecord {
  id: UUID; opportunityId: UUID; revisionNumber: number; revisionKey: string; revisionType: string; state: OpportunityRecord["currentState"];
  triggerEventId: string; evidenceRefs: Json; agentOutputs: Json; safetyResult: Json; opportunityScore: number;
  riskScore: number | null; dataQuality: number; informationCutoffAt: ISODateTime; createdAt: ISODateTime;
}
export interface EvidenceRecord { evidenceId: string; evidenceType: string; sourceTable: string; sourceRecordId: string; availableAt: ISODateTime; payloadHash: string; metadata: Json; createdAt: ISODateTime; }
