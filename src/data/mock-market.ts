import type { MarketPulse, Opportunity } from "@/domain/market";

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

