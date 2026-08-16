import type { MarketPulse, Opportunity, RecentSignal, SmartMoneyCluster, StockRadarItem, WatchlistAsset } from "@/domain/market";

export const opportunities: Opportunity[] = [
  {
    id: "amd", symbol: "AMD", name: "Advanced Micro Devices", kind: "stock",
    opportunityScore: 87, riskScore: 58, confidence: 74, direction: "bullish",
    summary: "Institutional flow and analyst revisions are accelerating ahead of the next catalyst window.",
    factors: ["Institutional flow increasing", "Positive analyst revisions", "Unusual volume"],
    negativeFactors: 2, price: 176.42, change24h: 3.84, updatedAt: "2 min ago",
  },
  {
    id: "layooo", symbol: "LAYOOO", name: "Layooo", kind: "crypto",
    opportunityScore: 84, riskScore: 91, confidence: 66, direction: "bullish",
    summary: "Five high-score wallets entered within eight minutes; liquidity remains the primary constraint.",
    factors: ["5 elite wallets entered", "Entry cluster: 8 minutes", "Market cap: $1.1M"],
    negativeFactors: 4, price: 0.00114, change24h: 18.7, updatedAt: "38 sec ago",
  },
  {
    id: "nvda", symbol: "NVDA", name: "NVIDIA", kind: "stock",
    opportunityScore: 81, riskScore: 47, confidence: 78, direction: "bullish",
    summary: "News sentiment and forward earnings estimates are improving together.",
    factors: ["Sentiment accelerating", "Earnings estimates increasing", "Relative strength: 92nd percentile"],
    negativeFactors: 3, price: 141.97, change24h: 1.62, updatedAt: "4 min ago",
  },
  {
    id: "sol", symbol: "SOL", name: "Solana", kind: "crypto",
    opportunityScore: 76, riskScore: 64, confidence: 71, direction: "neutral",
    summary: "Network activity is expanding, while short-term momentum has started to cool.",
    factors: ["DEX volume +24% WoW", "Active wallets expanding", "Funding rate normalized"],
    negativeFactors: 3, price: 183.21, change24h: -0.74, updatedAt: "1 min ago",
  },
];

export const marketPulse: MarketPulse[] = [
  { label: "S&P 500", value: "5,996.66", change: "+0.42%", tone: "positive" },
  { label: "NASDAQ", value: "19,630.20", change: "+0.71%", tone: "positive" },
  { label: "BTC", value: "$97,842", change: "+1.18%", tone: "positive" },
  { label: "Market regime", value: "Risk-on", change: "Moderate", tone: "neutral" },
];

export const smartMoneyClusters: SmartMoneyCluster[] = [
  { token: "LAYOOO", walletCount: 5, averageWalletScore: 89, windowMinutes: 8, signalScore: 92, marketCapUsd: 1_100_000, risk: "extreme" },
  { token: "JUP", walletCount: 4, averageWalletScore: 84, windowMinutes: 21, signalScore: 78, marketCapUsd: 1_420_000_000, risk: "medium" },
  { token: "KMNO", walletCount: 3, averageWalletScore: 81, windowMinutes: 34, signalScore: 71, marketCapUsd: 188_000_000, risk: "high" },
];

export const stockRadar: StockRadarItem[] = [
  { symbol: "AMD", signal: "bullish", score: 87, catalyst: "Analyst revisions accelerating", change: 3.84 },
  { symbol: "NVDA", signal: "bullish", score: 81, catalyst: "Forward estimates raised", change: 1.62 },
  { symbol: "TSLA", signal: "bearish", score: 42, catalyst: "Margin uncertainty increasing", change: -2.14 },
];

export const recentSignals: RecentSignal[] = [
  { id: "s1", symbol: "LAYOOO", label: "Wallet cluster detected", scoreImpact: 14, occurredAt: "18:44" },
  { id: "s2", symbol: "AMD", label: "Unusual volume 2.7x", scoreImpact: 12, occurredAt: "18:41" },
  { id: "s3", symbol: "SOL", label: "Concentration risk increased", scoreImpact: -8, occurredAt: "18:37" },
  { id: "s4", symbol: "NVDA", label: "Estimate revision", scoreImpact: 9, occurredAt: "18:29" },
];

export const watchlist: WatchlistAsset[] = [
  { symbol: "AAPL", name: "Apple", kind: "stock", price: 226.05, change: 0.48, score: 68 },
  { symbol: "COIN", name: "Coinbase", kind: "stock", price: 321.14, change: -1.21, score: 73 },
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", price: 97842, change: 1.18, score: 79 },
];
