export const TOKEN_RISK_MODEL_VERSION = "token-risk-v1" as const;
export type TokenRiskClassification = "clear" | "watch" | "rug_confirmed" | "unknown";
export interface AssessedTradeRisk { assetId: string; classification: TokenRiskClassification | null; }
export interface RugExposureMetrics { rugExposureRate: number | null; assessedTrades: number; exposedTrades: number; coverage: number; }
export interface PointInTimeRisk { assetId: string; status: "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "CONFIRMED_RUG" | "UNKNOWN"; score: number | null; informationCutoffAt: string; informationAvailableAt: string; dataQuality: number; }

export function selectRiskAt(records: PointInTimeRisk[], assetId: string, timestamp: string) {
  return records.filter((item) => item.assetId === assetId && item.informationCutoffAt <= timestamp && item.informationAvailableAt <= timestamp)
    .sort((a, b) => b.informationCutoffAt.localeCompare(a.informationCutoffAt) || b.informationAvailableAt.localeCompare(a.informationAvailableAt))[0] ?? null;
}

export function calculateRugExposure(trades: AssessedTradeRisk[]): RugExposureMetrics {
  if (!trades.length) return { rugExposureRate: null, assessedTrades: 0, exposedTrades: 0, coverage: 0 };
  const assessed = trades.filter((trade) => trade.classification && trade.classification !== "unknown");
  const exposed = assessed.filter((trade) => trade.classification === "rug_confirmed");
  return { rugExposureRate: assessed.length ? exposed.length / assessed.length : null, assessedTrades: assessed.length,
    exposedTrades: exposed.length, coverage: Math.round(assessed.length / trades.length * 100) };
}
