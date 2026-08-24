export type AssetKind = "stock" | "crypto" | "forex";
export type SignalDirection = "bullish" | "bearish" | "neutral";
export type RiskLevel = "low" | "medium" | "high" | "extreme";

export interface Opportunity {
  id: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  opportunityScore: number;
  riskScore: number;
  confidence: number;
  direction: SignalDirection;
  summary: string;
  factors: string[];
  negativeFactors: number;
  price: number | null;
  change24h: number | null;
  updatedAt: string;
  dataMode?: "live" | "stale" | "degraded" | "unavailable";
}

export interface MarketPulse {
  label: string;
  value: string;
  change: string;
  tone: "positive" | "negative" | "neutral";
  dataMode?: "live" | "stale" | "degraded" | "unavailable";
}

export interface SmartMoneyCluster {
  token: string; walletCount: number; averageWalletScore: number;
  windowMinutes: number; signalScore: number; marketCapUsd: number; risk: RiskLevel;
}

export interface StockRadarItem {
  symbol: string; signal: SignalDirection; score: number | null; catalyst: string; change: number | null;
}

export interface RecentSignal {
  id: string; symbol: string; label: string; scoreImpact: number | null; occurredAt: string;
}

export interface WatchlistAsset {
  symbol: string; name: string; kind: AssetKind; price: number; change: number; score: number;
}
