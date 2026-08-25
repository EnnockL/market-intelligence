export const PERFORMANCE_MODEL_VERSION = "performance-agent-v1";
export type Metric<T = number> =
  | { status: "VALUE"; value: T }
  | { status: "INSUFFICIENT_DATA"; value: null; reason: string };
export interface PerformanceInput {
  initialCash: number;
  currentCash: number;
  evaluations: { candidateId: string; status: string; reason: string }[];
  orders: {
    id: string;
    status: string;
    requested: number;
    executed: number;
    fees: number;
    slippageCost: number;
  }[];
  positions: {
    openedAt: string;
    closedAt: string | null;
    realizedPnl: number;
    unrealizedPnl: number;
    marketValue: number;
    costBasis: number;
  }[];
  equityPoints: { at: string; equity: number }[];
}
export function calculatePerformance(input: PerformanceInput) {
  const observed = new Set(input.evaluations.map((x) => x.candidateId)).size,
    evaluated = input.evaluations.length,
    eligible = input.evaluations.filter((x) => x.status === "ELIGIBLE").length,
    ordered = input.orders.length,
    filled = input.orders.filter((x) =>
      ["FILLED", "PARTIALLY_FILLED"].includes(x.status),
    ).length,
    partial = input.orders.filter(
      (x) => x.status === "PARTIALLY_FILLED",
    ).length,
    closed = input.positions.filter((x) => x.closedAt),
    rejectReasons = count(
      input.evaluations
        .filter((x) => x.status === "REJECTED")
        .map((x) => x.reason),
    ),
    blockers = count([
      ...input.evaluations
        .filter((x) => x.status === "REJECTED")
        .map((x) => x.reason),
      ...input.orders
        .filter((x) => x.status === "REJECTED")
        .map((x) => "ORDER_" + x.status),
    ]);
  const currentEquity =
      input.currentCash +
      input.positions
        .filter((x) => !x.closedAt)
        .reduce((n, x) => n + x.marketValue, 0),
    realized = input.positions.reduce((n, x) => n + x.realizedPnl, 0),
    unrealized = input.positions
      .filter((x) => !x.closedAt)
      .reduce((n, x) => n + x.unrealizedPnl, 0),
    trades = closed.length,
    wins = closed.filter((x) => x.realizedPnl > 0),
    losses = closed.filter((x) => x.realizedPnl < 0),
    grossProfit = wins.reduce((n, x) => n + x.realizedPnl, 0),
    grossLoss = Math.abs(losses.reduce((n, x) => n + x.realizedPnl, 0));
  return {
    funnel: {
      observed,
      evaluated,
      eligible,
      ordered,
      filled,
      closed: closed.length,
    },
    rates: {
      eligible: evaluated ? (eligible / evaluated) * 100 : 0,
      reject: evaluated ? ((evaluated - eligible) / evaluated) * 100 : 0,
      fill: ordered ? (filled / ordered) * 100 : 0,
      partial: ordered ? (partial / ordered) * 100 : 0,
      liquidityRejection: evaluated
        ? ((rejectReasons.INSUFFICIENT_LIQUIDITY_DATA ?? 0) / evaluated) * 100
        : 0,
    },
    rejectReasons,
    blockers,
    coverage: {
      candidateCoverage: observed ? (evaluated / observed) * 100 : 0,
      tradeSample: trades,
    },
    metrics: {
      currentEquity: value(currentEquity),
      returnPct: value((currentEquity / input.initialCash - 1) * 100),
      realizedPnl: value(realized),
      unrealizedPnl: value(unrealized),
      fees: value(input.orders.reduce((n, x) => n + x.fees, 0)),
      slippageCost: value(input.orders.reduce((n, x) => n + x.slippageCost, 0)),
      winRate: trades
        ? value((wins.length / trades) * 100)
        : insufficient("NO_CLOSED_TRADES"),
      profitFactor:
        trades && grossLoss > 0
          ? value(grossProfit / grossLoss)
          : insufficient("NO_CLOSED_LOSING_TRADES"),
      expectedValue: trades
        ? value(closed.reduce((n, x) => n + x.realizedPnl, 0) / trades)
        : insufficient("NO_CLOSED_TRADES"),
      averageHoldingHours: trades
        ? value(
            closed.reduce(
              (n, x) =>
                n +
                (Date.parse(x.closedAt!) - Date.parse(x.openedAt)) / 3600000,
              0,
            ) / trades,
          )
        : insufficient("NO_CLOSED_TRADES"),
      maxDrawdown:
        input.equityPoints.length >= 2
          ? value(drawdown(input.equityPoints))
          : insufficient("FEWER_THAN_TWO_EQUITY_POINTS"),
    },
  };
}
function value<T>(v: T): Metric<T> {
  return { status: "VALUE", value: v };
}
function insufficient(reason: string): Metric {
  return { status: "INSUFFICIENT_DATA", value: null, reason };
}
function count(values: string[]) {
  return values.reduce<Record<string, number>>(
    (a, x) => ((a[x] = (a[x] ?? 0) + 1), a),
    {},
  );
}
function drawdown(points: { at: string; equity: number }[]) {
  let peak = 0,
    max = 0;
  for (const p of [...points].sort((a, b) => a.at.localeCompare(b.at))) {
    peak = Math.max(peak, p.equity);
    if (peak) max = Math.max(max, ((peak - p.equity) / peak) * 100);
  }
  return max;
}
