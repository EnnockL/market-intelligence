export const POSITION_ENGINE_VERSION = "weighted-average-v1" as const;
export interface EnrichedWalletTrade {
  id: string; signature: string; instructionIndex: number; token: string; side: "buy" | "sell";
  quantity: number; occurredAt: string; tokenPriceUsd: number | null; feeUsd: number | null;
  pricingComplete: boolean; executionComplete: boolean; informationCompleteness: number;
}
export interface TradeCycle {
  cycleNumber: number; token: string; status: "open" | "closed" | "incomplete"; quantity: number;
  investedUsd: number | null; costBasisUsd: number | null; averageEntryUsd: number | null;
  proceedsUsd: number | null; realizedPnlUsd: number | null; unrealizedPnlUsd: number | null;
  returnPercent: number | null; firstEntryAt: string; finalExitAt: string | null; holdingSeconds: number | null;
  pricingCompleteness: number; transactionCompleteness: number; executionCompleteness: number; informationCompleteness: number; dataQuality: number;
  engineVersion: typeof POSITION_ENGINE_VERSION; transactionIds: string[];
}
export interface WalletPnlMetrics {
  closedTrades: number; wins: number; losses: number; winRate: number | null; medianReturn: number | null;
  meanReturn: number | null; realizedPnlUsd: number | null; bestTradePercent: number | null;
  worstTradePercent: number | null; medianHoldingSeconds: number | null; sampleSize: number; verifiedTrades: number;
  maxDrawdown: number | null;
}

type MutableCycle = TradeCycle & { priced: number; valid: number; executionKnown: number; informationTotal: number; total: number; costRemaining: number | null };
export function reconstructTradeCycles(input: EnrichedWalletTrade[], currentPriceUsd: number | null = null): TradeCycle[] {
  const events = dedupe(input).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.signature.localeCompare(b.signature) || a.instructionIndex - b.instructionIndex);
  const result: TradeCycle[] = []; let cycle: MutableCycle | null = null; let cycleNumber = 0;
  for (const event of events) {
    if (!cycle && event.side === "sell") continue;
    if (!cycle) cycle = emptyCycle(event.token, ++cycleNumber, event.occurredAt);
    const valid = event.quantity > 0 && Number.isFinite(event.quantity) && (event.side === "buy" || event.quantity <= cycle.quantity + 1e-12);
    cycle.total += 1; cycle.valid += valid ? 1 : 0; cycle.priced += event.pricingComplete && event.tokenPriceUsd !== null ? 1 : 0; cycle.executionKnown += event.executionComplete && event.feeUsd !== null ? 1 : 0; cycle.informationTotal += Math.max(0, Math.min(100, event.informationCompleteness)); cycle.transactionIds.push(event.id);
    if (!valid) continue;
    const gross = event.tokenPriceUsd === null ? null : event.quantity * event.tokenPriceUsd;
    const fee = event.feeUsd;
    if (event.side === "buy") {
      cycle.quantity += event.quantity;
      if (gross === null || fee === null || cycle.costRemaining === null) cycle.costRemaining = null;
      else cycle.costRemaining += gross + fee;
      cycle.investedUsd = addNullable(cycle.investedUsd, gross === null || fee === null ? null : gross + fee);
      cycle.costBasisUsd = cycle.costRemaining;
      cycle.averageEntryUsd = cycle.costRemaining === null || cycle.quantity === 0 ? null : cycle.costRemaining / cycle.quantity;
      continue;
    }
    const soldQuantity = Math.min(event.quantity, cycle.quantity);
    const averageCost = cycle.quantity > 0 && cycle.costRemaining !== null ? cycle.costRemaining / cycle.quantity : null;
    const soldCost = averageCost === null ? null : averageCost * soldQuantity;
    const netProceeds = gross === null || fee === null ? null : gross - fee;
    cycle.proceedsUsd = addNullable(cycle.proceedsUsd, netProceeds);
    cycle.realizedPnlUsd = addNullable(cycle.realizedPnlUsd, netProceeds === null || soldCost === null ? null : netProceeds - soldCost);
    cycle.costRemaining = cycle.costRemaining === null || soldCost === null ? null : Math.max(0, cycle.costRemaining - soldCost);
    cycle.costBasisUsd = cycle.costRemaining;
    cycle.quantity = Math.max(0, cycle.quantity - soldQuantity);
    if (cycle.quantity <= 1e-12) {
      cycle.quantity = 0; cycle.finalExitAt = event.occurredAt; cycle.holdingSeconds = secondsBetween(cycle.firstEntryAt, event.occurredAt);
      cycle.returnPercent = cycle.realizedPnlUsd === null || cycle.investedUsd === null || cycle.investedUsd === 0 ? null : cycle.realizedPnlUsd / cycle.investedUsd * 100;
      result.push(finalize(cycle)); cycle = null;
    }
  }
  if (cycle) {
    cycle.unrealizedPnlUsd = currentPriceUsd === null || cycle.costRemaining === null ? null : cycle.quantity * currentPriceUsd - cycle.costRemaining;
    result.push(finalize(cycle));
  }
  return result;
}

export function calculateWalletPnlMetrics(cycles: TradeCycle[]): WalletPnlMetrics {
  const closed = cycles.filter((cycle) => cycle.finalExitAt !== null);
  const verified = closed.filter((cycle) => cycle.dataQuality === 100 && cycle.returnPercent !== null && cycle.realizedPnlUsd !== null);
  const returns = verified.map((cycle) => cycle.returnPercent!); const pnl = verified.map((cycle) => cycle.realizedPnlUsd!);
  const holds = verified.flatMap((cycle) => cycle.holdingSeconds === null ? [] : [cycle.holdingSeconds]);
  return { closedTrades: closed.length, wins: pnl.filter((value) => value > 0).length, losses: pnl.filter((value) => value < 0).length,
    winRate: verified.length ? pnl.filter((value) => value > 0).length / verified.length : null,
    medianReturn: median(returns), meanReturn: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null,
    realizedPnlUsd: pnl.length ? pnl.reduce((a, b) => a + b, 0) : null, bestTradePercent: returns.length ? Math.max(...returns) : null,
    worstTradePercent: returns.length ? Math.min(...returns) : null, medianHoldingSeconds: median(holds), sampleSize: closed.length,
    verifiedTrades: verified.length, maxDrawdown: calculateCompoundedMaxDrawdown(verified) };
}

export function calculateCompoundedMaxDrawdown(cycles: TradeCycle[]): number | null {
  const returns = cycles.filter((cycle) => cycle.dataQuality === 100 && cycle.finalExitAt && cycle.returnPercent !== null)
    .sort((a, b) => a.finalExitAt!.localeCompare(b.finalExitAt!)).map((cycle) => cycle.returnPercent! / 100);
  if (!returns.length) return null;
  let equity = 1; let peak = 1; let maximum = 0;
  for (const tradeReturn of returns) { equity *= Math.max(0, 1 + tradeReturn); peak = Math.max(peak, equity); maximum = Math.max(maximum, peak === 0 ? 0 : (peak - equity) / peak); }
  return maximum;
}

function emptyCycle(token: string, cycleNumber: number, firstEntryAt: string): MutableCycle { return { cycleNumber, token, status: "open", quantity: 0, investedUsd: 0, costBasisUsd: 0, averageEntryUsd: null, proceedsUsd: 0, realizedPnlUsd: 0, unrealizedPnlUsd: null, returnPercent: null, firstEntryAt, finalExitAt: null, holdingSeconds: null, pricingCompleteness: 0, transactionCompleteness: 0, executionCompleteness: 0, informationCompleteness: 0, dataQuality: 0, engineVersion: POSITION_ENGINE_VERSION, transactionIds: [], priced: 0, valid: 0, executionKnown: 0, informationTotal: 0, total: 0, costRemaining: 0 }; }
function finalize(cycle: MutableCycle): TradeCycle { const pricingCompleteness = percent(cycle.priced, cycle.total); const transactionCompleteness = percent(cycle.valid, cycle.total); const executionCompleteness = percent(cycle.executionKnown, cycle.total); const informationCompleteness = cycle.total ? Math.round(cycle.informationTotal / cycle.total) : 0; const dataQuality = Math.round(pricingCompleteness * .4 + transactionCompleteness * .2 + executionCompleteness * .2 + informationCompleteness * .2); const { priced: _p, valid: _v, executionKnown: _e, informationTotal: _i, total: _t, costRemaining: _c, ...value } = cycle; return { ...value, status: dataQuality === 100 ? (cycle.finalExitAt ? "closed" : "open") : "incomplete", pricingCompleteness, transactionCompleteness, executionCompleteness, informationCompleteness, dataQuality }; }
function dedupe(items: EnrichedWalletTrade[]) { return [...new Map(items.map((item) => [`${item.signature}:${item.instructionIndex}`, item])).values()]; }
function addNullable(current: number | null, next: number | null) { return current === null || next === null ? null : current + next; }
function percent(value: number, total: number) { return total ? Math.round(value / total * 100) : 0; }
function secondsBetween(a: string, b: string) { return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000); }
function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
