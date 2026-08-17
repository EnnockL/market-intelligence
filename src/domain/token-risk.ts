export const TOKEN_RISK_MODEL_VERSION = "token-risk-v1" as const;
export type TokenRiskClassification = "clear" | "watch" | "rug_confirmed" | "unknown";
export interface AssessedTradeRisk { assetId: string; classification: TokenRiskClassification | null; }
export interface RugExposureMetrics { rugExposureRate: number | null; assessedTrades: number; exposedTrades: number; coverage: number; }
export interface PointInTimeRisk { assetId: string; status: "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "CONFIRMED_RUG" | "UNKNOWN"; score: number | null; informationCutoffAt: string; informationAvailableAt: string; dataQuality: number; }
export interface RiskComponent { key: string; value: string | number | boolean | null; status: "safe" | "warning" | "critical" | "unknown"; observedAt: string; informationAvailableAt: string; source: string; }

export function evaluateTokenRisk(components: RiskComponent[]) {
  const byKey = new Map(components.map((item) => [item.key, item])); const known = components.filter((item) => item.status !== "unknown");
  const quality = components.length ? Math.round(known.length / components.length * 100) : 0;
  const confirmed = ["honeypot", "known_scam"].some((key) => byKey.get(key)?.value === true);
  const critical = components.filter((item) => item.status === "critical").length; const warnings = components.filter((item) => item.status === "warning").length;
  const status = confirmed ? "CONFIRMED_RUG" : quality < 60 ? "UNKNOWN" : critical ? "HIGH_RISK" : warnings ? "ELEVATED" : "LOW_RISK";
  const score = status === "UNKNOWN" ? null : Math.min(100, (confirmed ? 100 : 0) + critical * 35 + warnings * 12);
  return { status, score, dataQuality: quality } as const;
}

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
