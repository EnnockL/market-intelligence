export const MARKET_EVENT_POLICY = {
  version: "market-event-producers-v1",
  baselineVersion: "market-baseline-v1",
  windowSeconds: 300,
  priceChangePct: 20,
  volumeMultiple: 2,
  liquidityChangePct: 25,
} as const;
export interface MarketObservation {
  id: string;
  assetId: string;
  provider: string;
  observedAt: string;
  availableAt: string;
  price: number | null;
  volume: number | null;
  liquidity: number | null;
  poolAddress: string | null;
  dataQuality: number;
}
export interface ProducerResult {
  eventType: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
}
export interface WalletInflowObservation {
  walletId: string;
  assetId: string;
  transactionId: string;
  occurredAt: string;
  availableAt: string;
}
export function detectNewWalletInflows(
  rows: WalletInflowObservation[],
  trackedWallets: number,
  minimumWallets = 3,
): ProducerResult[] {
  const first = new Map<string, WalletInflowObservation>();
  for (const row of [...rows].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.transactionId.localeCompare(b.transactionId),
  )) {
    const key = `${row.assetId}:${row.walletId}`;
    if (!first.has(key)) first.set(key, row);
  }
  const byAsset = new Map<string, WalletInflowObservation[]>();
  for (const row of first.values()) {
    const list = byAsset.get(row.assetId) ?? [];
    list.push(row);
    byAsset.set(row.assetId, list);
  }
  const results: ProducerResult[] = [];
  for (const [assetId, list] of byAsset) {
    list.sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) ||
        a.transactionId.localeCompare(b.transactionId),
    );
    for (let end = 0; end < list.length; end++) {
      const cutoff =
        Date.parse(list[end].occurredAt) -
        MARKET_EVENT_POLICY.windowSeconds * 1000;
      const window = list
        .slice(0, end + 1)
        .filter((row) => Date.parse(row.occurredAt) >= cutoff);
      if (window.length < minimumWallets) continue;
      const coverage =
        trackedWallets > 0
          ? Math.min(
              100,
              Math.round(
                (new Set(rows.map((row) => row.walletId)).size /
                  trackedWallets) *
                  100,
              ),
            )
          : 0;
      results.push({
        eventType: "market.new_wallet_inflow",
        reason: null,
        payload: {
          assetId,
          newWalletsDetected: window.length,
          observationWindowSeconds: MARKET_EVENT_POLICY.windowSeconds,
          walletObservationCoverage: coverage,
          classification: "PARTIAL_COVERAGE",
          transactionIds: window.map((row) => row.transactionId),
          currentObservedAt: list[end].occurredAt,
          availableAt: window.reduce(
            (max, row) => (row.availableAt > max ? row.availableAt : max),
            window[0].availableAt,
          ),
          baselineVersion: MARKET_EVENT_POLICY.baselineVersion,
        },
      });
      break;
    }
  }
  return results;
}
export function compareMarket(
  current: MarketObservation,
  baseline: MarketObservation | null,
): ProducerResult[] {
  if (!baseline)
    return [
      {
        eventType: null,
        reason: "INSUFFICIENT_HISTORY",
        payload: {
          baselineVersion: MARKET_EVENT_POLICY.baselineVersion,
          windowSeconds: MARKET_EVENT_POLICY.windowSeconds,
        },
      },
    ];
  const common = {
    baselineVersion: MARKET_EVENT_POLICY.baselineVersion,
    windowSeconds: MARKET_EVENT_POLICY.windowSeconds,
    currentObservedAt: current.observedAt,
    baselineObservedAt: baseline.observedAt,
    provider: current.provider,
    dataQuality: Math.min(current.dataQuality, baseline.dataQuality),
  };
  const out: ProducerResult[] = [];
  if (current.poolAddress && !baseline.poolAddress)
    out.push({
      eventType: "pool.created",
      reason: null,
      payload: { ...common, poolAddress: current.poolAddress },
    });
  delta(
    out,
    "market.price_accelerated",
    current.price,
    baseline.price,
    MARKET_EVENT_POLICY.priceChangePct,
    common,
  );
  multiple(
    out,
    "market.volume_accelerated",
    current.volume,
    baseline.volume,
    MARKET_EVENT_POLICY.volumeMultiple,
    common,
  );
  if (
    current.liquidity !== null &&
    baseline.liquidity !== null &&
    baseline.liquidity > 0
  ) {
    const change = (current.liquidity / baseline.liquidity - 1) * 100;
    if (change >= MARKET_EVENT_POLICY.liquidityChangePct)
      out.push({
        eventType: "market.liquidity_added",
        reason: null,
        payload: {
          ...common,
          currentLiquidity: current.liquidity,
          baselineLiquidity: baseline.liquidity,
          changePct: change,
        },
      });
    if (change <= -MARKET_EVENT_POLICY.liquidityChangePct)
      out.push({
        eventType: "market.liquidity_removed",
        reason: null,
        payload: {
          ...common,
          currentLiquidity: current.liquidity,
          baselineLiquidity: baseline.liquidity,
          changePct: change,
        },
      });
  }
  return out.length
    ? out
    : [{ eventType: null, reason: "NO_THRESHOLD_CROSSED", payload: common }];
}
function delta(
  out: ProducerResult[],
  eventType: string,
  current: number | null,
  baseline: number | null,
  threshold: number,
  common: Record<string, unknown>,
) {
  if (current === null || baseline === null || baseline <= 0) return;
  const change = (current / baseline - 1) * 100;
  if (change >= threshold)
    out.push({
      eventType,
      reason: null,
      payload: {
        ...common,
        currentPrice: current,
        baselinePrice: baseline,
        changePct: change,
      },
    });
}
function multiple(
  out: ProducerResult[],
  eventType: string,
  current: number | null,
  baseline: number | null,
  threshold: number,
  common: Record<string, unknown>,
) {
  if (current === null || baseline === null || baseline <= 0) return;
  const value = current / baseline;
  if (value >= threshold)
    out.push({
      eventType,
      reason: null,
      payload: {
        ...common,
        currentVolume: current,
        baselineVolume: baseline,
        multiple: value,
      },
    });
}
