export type AssetKind = "stock" | "crypto";
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
  price: number;
  change24h: number;
  updatedAt: string;
}

export interface MarketPulse {
  label: string;
  value: string;
  change: string;
  tone: "positive" | "negative" | "neutral";
}

