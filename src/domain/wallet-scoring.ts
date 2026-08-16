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

