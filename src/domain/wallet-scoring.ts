export interface WalletMetrics {
  tradeCount: number;
  winRate: number;
  medianReturn: number;
  realizedPnl30d: number;
  rugExposureRate: number;
  maxDrawdown: number;
  profitableMonths: number;
  trackedMonths: number;
}

export interface ScoreComponent {
  name: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
  contribution: number;
}

export interface WalletScoreResult {
  score: number;
  dataQuality: number;
  components: ScoreComponent[];
  version: "wallet-v1";
}

export interface WalletMetricsV2 {
  closedTrades: number; verifiedTrades: number; winRate: number | null; medianReturn: number | null;
  realizedPnlUsd: number | null; maxDrawdown: number | null; rugExposureRate: number | null;
  medianHoldingSeconds: number | null; overallDataQuality: number;
}
export type WalletScoreV2Result = Omit<WalletScoreResult, "version"> & { version: "wallet-v2"; lifecycle: "candidate" | "reviewing"; missingComponents: string[]; };
export interface WalletMetricsV3 { verifiedTrades: number; winRate: number | null; medianReturn: number | null; realizedPnlUsd: number | null; maxDrawdown: number | null; rugExposureRate: number | null; entryQuality: number | null; executionQuality: number | null; overallDataQuality: number; }
export interface WalletScoreV3Result { score: number; dataQuality: number; components: ScoreComponent[]; version: "wallet-score-v3"; missingComponents: string[]; }

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

export function calculateWalletScore(metrics: WalletMetrics): WalletScoreResult {
  const sampleQuality = clamp((metrics.tradeCount / 100) * 100);
  const consistency = metrics.trackedMonths > 0
    ? clamp((metrics.profitableMonths / metrics.trackedMonths) * 100)
    : 0;

  const definitions = [
    { name: "win_rate", raw: metrics.winRate, score: clamp(metrics.winRate * 100), weight: 0.3 },
    { name: "median_return", raw: metrics.medianReturn, score: clamp((metrics.medianReturn + 0.2) / 1.2 * 100), weight: 0.2 },
    { name: "realized_pnl_30d", raw: metrics.realizedPnl30d, score: clamp(50 + metrics.realizedPnl30d / 10_000), weight: 0.15 },
    { name: "drawdown", raw: metrics.maxDrawdown, score: clamp(100 - metrics.maxDrawdown * 200), weight: 0.15 },
    { name: "rug_safety", raw: metrics.rugExposureRate, score: clamp(100 - metrics.rugExposureRate * 250), weight: 0.1 },
    { name: "consistency", raw: consistency, score: consistency, weight: 0.1 },
  ];

  const components = definitions.map((component) => ({
    name: component.name,
    rawValue: component.raw,
    normalizedScore: Math.round(component.score * 100) / 100,
    weight: component.weight,
    contribution: Math.round(component.score * component.weight * 100) / 100,
  }));
  const unadjusted = components.reduce((sum, component) => sum + component.contribution, 0);
  const qualityMultiplier = 0.5 + 0.5 * (sampleQuality / 100);

  return {
    score: Math.round(clamp(unadjusted * qualityMultiplier)),
    dataQuality: Math.round(sampleQuality),
    components,
    version: "wallet-v1",
  };
}

export function calculateWalletScoreV2(metrics: WalletMetricsV2): WalletScoreV2Result {
  const missingComponents = [metrics.winRate === null ? "win_rate" : null, metrics.medianReturn === null ? "median_return" : null,
    metrics.realizedPnlUsd === null ? "realized_pnl" : null, metrics.maxDrawdown === null ? "max_drawdown" : null,
    metrics.rugExposureRate === null ? "rug_exposure" : null].filter((item): item is string => item !== null);
  const sample = clamp(metrics.verifiedTrades / 100 * 100); const componentCompleteness = (5 - missingComponents.length) / 5 * 100;
  const completeness = clamp(metrics.overallDataQuality * .6 + componentCompleteness * .4);
  const values = [
    { name: "profitability", raw: metrics.realizedPnlUsd ?? 0, score: metrics.realizedPnlUsd === null ? 0 : clamp(50 + metrics.realizedPnlUsd / 5_000), weight: .25 },
    { name: "win_rate", raw: metrics.winRate ?? 0, score: metrics.winRate === null ? 0 : clamp(metrics.winRate * 100), weight: .2 },
    { name: "median_return", raw: metrics.medianReturn ?? 0, score: metrics.medianReturn === null ? 0 : clamp(50 + metrics.medianReturn), weight: .15 },
    { name: "downside_control", raw: metrics.maxDrawdown ?? 0, score: metrics.maxDrawdown === null ? 0 : clamp(100 - metrics.maxDrawdown * 200), weight: .15 },
    { name: "rug_safety", raw: metrics.rugExposureRate ?? 0, score: metrics.rugExposureRate === null ? 0 : clamp(100 - metrics.rugExposureRate * 250), weight: .1 },
    { name: "sample_size", raw: metrics.verifiedTrades, score: sample, weight: .05 },
    { name: "data_completeness", raw: completeness, score: completeness, weight: .1 },
  ];
  const components = values.map((item) => ({ name: item.name, rawValue: item.raw, normalizedScore: Math.round(item.score * 100) / 100, weight: item.weight, contribution: Math.round(item.score * item.weight * 100) / 100 }));
  const score = Math.round(clamp(components.reduce((sum, item) => sum + item.contribution, 0) * (.5 + sample / 200)));
  return { score, dataQuality: Math.round(completeness), components, version: "wallet-v2", lifecycle: metrics.verifiedTrades >= 20 && completeness >= 80 && missingComponents.length === 0 ? "reviewing" : "candidate", missingComponents };
}

export function calculateWalletScoreV3(metrics: WalletMetricsV3): WalletScoreV3Result {
  const missing = [["profitability", metrics.realizedPnlUsd], ["consistency", metrics.winRate], ["drawdown", metrics.maxDrawdown], ["rug_exposure", metrics.rugExposureRate], ["entry_quality", metrics.entryQuality], ["execution_quality", metrics.executionQuality]].filter(([, value]) => value === null).map(([name]) => String(name));
  const definitions = [
    { name: "profitability", raw: metrics.realizedPnlUsd, score: metrics.realizedPnlUsd === null ? 0 : clamp(50 + metrics.realizedPnlUsd / 5000), weight: .2 },
    { name: "consistency", raw: metrics.winRate, score: metrics.winRate === null ? 0 : clamp(metrics.winRate * 100), weight: .15 },
    { name: "median_return", raw: metrics.medianReturn, score: metrics.medianReturn === null ? 0 : clamp(50 + metrics.medianReturn), weight: .1 },
    { name: "drawdown_control", raw: metrics.maxDrawdown, score: metrics.maxDrawdown === null ? 0 : clamp(100 - metrics.maxDrawdown * 200), weight: .15 },
    { name: "rug_safety", raw: metrics.rugExposureRate, score: metrics.rugExposureRate === null ? 0 : clamp(100 - metrics.rugExposureRate * 250), weight: .1 },
    { name: "entry_quality", raw: metrics.entryQuality, score: metrics.entryQuality ?? 0, weight: .08 },
    { name: "execution_quality", raw: metrics.executionQuality, score: metrics.executionQuality ?? 0, weight: .07 },
    { name: "data_completeness", raw: metrics.overallDataQuality, score: metrics.overallDataQuality, weight: .15 },
  ];
  const components = definitions.map((item) => ({ name: item.name, rawValue: item.raw ?? 0, normalizedScore: Math.round(item.score * 100) / 100, weight: item.weight, contribution: Math.round(item.score * item.weight * 100) / 100 }));
  const sampleMultiplier = Math.min(1, Math.sqrt(metrics.verifiedTrades / 20));
  return { score: Math.round(clamp(components.reduce((sum, item) => sum + item.contribution, 0) * sampleMultiplier)), dataQuality: Math.round(metrics.overallDataQuality), components, version: "wallet-score-v3", missingComponents: missing };
}
