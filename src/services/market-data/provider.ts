import type { Asset, ISODateTime, WalletTransaction } from "@/domain/database";

export interface PricePoint {
  assetId: string; capturedAt: ISODateTime; close: string; volume: string | null;
  marketCapUsd: string | null; providerEventId: string;
}

export interface MarketDataProvider {
  readonly name: string;
  getAssets(symbols: string[]): Promise<Asset[]>;
  getPrices(assetIds: string[], since: ISODateTime): Promise<PricePoint[]>;
}

export interface BlockchainDataProvider {
  readonly chain: string;
  getWalletTransactions(addresses: string[], since: ISODateTime): Promise<WalletTransaction[]>;
}

