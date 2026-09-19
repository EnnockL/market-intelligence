import { deterministicDigest } from "./events";
import type { DemoAccountBaseline, DemoAccountEvidence } from "@/services/execution/account-evidence";

export interface NativeFill {
  id: string; provider_order_id: string; instrument_id: string; base_currency: string; quote_currency: string;
  side: "BUY" | "SELL"; quantity: number; price: number; fee_amount: number; fee_currency: string; occurred_at: string;
}
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-10, Math.max(Math.abs(a), Math.abs(b)) * 1e-10);
const require = (valid: boolean, reason: string) => { if (!valid) throw new Error(`DEMO_RECONCILIATION:${reason}`); };

export function createDemoBaseline(evidence: DemoAccountEvidence, includeExistingHoldings = false): DemoAccountBaseline {
  require(evidence.complete === true && evidence.orders.length === 0 && evidence.bills.length === 0, "QUIET_BASELINE_REQUIRED");
  require(includeExistingHoldings || evidence.balances.every(x => x.currency === evidence.quoteCurrency || x.total === 0), "ZERO_OPENING_INVENTORY_REQUIRED");
  require(evidence.balances.every(x => Number.isFinite(x.total) && x.total >= 0 && close(x.total, x.available)), "UNRESERVED_OPENING_HOLDINGS_REQUIRED");
  require(new Set(evidence.balances.map(x => x.currency)).size === evidence.balances.length, "DUPLICATE_BALANCE");
  const cash = evidence.balances.find(x => x.currency === evidence.quoteCurrency);
  require(!!cash && cash.total > 0 && close(cash.total, cash.available), "UNRESERVED_OPENING_CASH_REQUIRED");
  return { version: "demo-account-baseline-v1", externalAccountId: evidence.externalAccountId, instrumentId: evidence.instrumentId,
    baseCurrency: evidence.baseCurrency, quoteCurrency: evidence.quoteCurrency, cash: cash!.total, at: evidence.startedAt, evidenceHash: deterministicDigest(evidence),
    ...(includeExistingHoldings ? { openingBalances: evidence.balances, openingMarks: evidence.holdingMarks ?? [], openingMark: evidence.mark,
      valuationPolicy: "OBSERVED_BASELINE_NOT_HISTORICAL_COST" as const } : {}) };
}

/** Reconstruct native balances independently from fills and every account bill. */
export function reconcileDemoAccount(baseline: DemoAccountBaseline, evidence: DemoAccountEvidence, fills: NativeFill[]) {
  require(baseline.version === "demo-account-baseline-v1" && Number.isFinite(baseline.cash) && baseline.cash > 0, "BASELINE_INVALID");
  require(evidence.complete === true && evidence.externalAccountId === baseline.externalAccountId, "ACCOUNT_IDENTITY_CHANGED");
  require(evidence.instrumentId === baseline.instrumentId && evidence.baseCurrency === baseline.baseCurrency && evidence.quoteCurrency === baseline.quoteCurrency
    && evidence.windowStart === baseline.at, "BASELINE_SCOPE_MISMATCH");
  const native = new Map([[baseline.baseCurrency, 0], [baseline.quoteCurrency, baseline.cash]]);
  if (baseline.openingBalances) {
    require(baseline.valuationPolicy === "OBSERVED_BASELINE_NOT_HISTORICAL_COST"
      && new Set(baseline.openingBalances.map(x => x.currency)).size === baseline.openingBalances.length, "BASELINE_INVALID");
    for (const balance of baseline.openingBalances) {
      require(Number.isFinite(balance.total) && balance.total >= 0 && close(balance.total, balance.available), "BASELINE_INVALID");
      native.set(balance.currency, balance.total);
    }
    require(close(native.get(baseline.quoteCurrency)!, baseline.cash), "BASELINE_INVALID");
  }
  const billTrades = new Map<string, number>(), fillTrades = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, delta: number) => map.set(key, (map.get(key) ?? 0) + delta);
  const billIds = new Set<string>();
  const bills = [...evidence.bills].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const bill of bills) {
    require(!billIds.has(bill.id), "DUPLICATE_BILL"); billIds.add(bill.id);
    require(native.has(bill.currency) && Number.isFinite(bill.change) && Number.isFinite(bill.balance) && bill.balance >= 0
      && Date.parse(bill.occurredAt) > Date.parse(baseline.at) && Date.parse(bill.occurredAt) <= Date.parse(evidence.observedAt), "BILL_SCOPE_INVALID");
    const next = native.get(bill.currency)! + bill.change;
    require(close(next, bill.balance), "BILL_BALANCE_CHAIN_MISMATCH");
    native.set(bill.currency, bill.balance);
    if (bill.type === "2") add(billTrades, `${bill.orderId}:${bill.currency}`, bill.change);
    else require(bill.type === "1" && bill.currency === baseline.quoteCurrency, "UNSUPPORTED_FUNDING_MOVEMENT");
  }
  const fillIds = new Set<string>();
  for (const fill of fills) {
    require(!fillIds.has(fill.id), "DUPLICATE_FILL"); fillIds.add(fill.id);
    require(fill.instrument_id === baseline.instrumentId && fill.base_currency === baseline.baseCurrency && fill.quote_currency === baseline.quoteCurrency
      && ["BUY", "SELL"].includes(fill.side) && fill.quantity > 0 && fill.price > 0 && [fill.quantity, fill.price, fill.fee_amount].every(Number.isFinite)
      && [baseline.baseCurrency, baseline.quoteCurrency].includes(fill.fee_currency)
      && Date.parse(fill.occurred_at) > Date.parse(baseline.at) && Date.parse(fill.occurred_at) <= Date.parse(evidence.observedAt), "FILL_SCOPE_INVALID");
    const sign = fill.side === "BUY" ? 1 : -1;
    add(fillTrades, `${fill.provider_order_id}:${baseline.baseCurrency}`, sign * fill.quantity - (fill.fee_currency === baseline.baseCurrency ? fill.fee_amount : 0));
    add(fillTrades, `${fill.provider_order_id}:${baseline.quoteCurrency}`, -sign * fill.quantity * fill.price - (fill.fee_currency === baseline.quoteCurrency ? fill.fee_amount : 0));
  }
  for (const key of new Set([...billTrades.keys(), ...fillTrades.keys()])) require(close(billTrades.get(key) ?? 0, fillTrades.get(key) ?? 0), "BILLS_AND_FILLS_DISAGREE");
  for (const currency of native.keys()) {
    const balance = evidence.balances.find(x => x.currency === currency);
    require(close(native.get(currency)!, balance?.total ?? 0), "PROVIDER_BALANCE_MISMATCH");
  }
  for (const balance of evidence.balances) {
    require(close(native.get(balance.currency) ?? 0, balance.total), "PROVIDER_BALANCE_MISMATCH");
    if (![baseline.baseCurrency, baseline.quoteCurrency].includes(balance.currency))
      require(close(balance.total, balance.available), "UNEXPLAINED_FROZEN_BALANCE");
  }
  const base = native.get(baseline.baseCurrency)!, cash = native.get(baseline.quoteCurrency)!;
  const reservedBase = evidence.orders.filter(x => x.side === "SELL").reduce((sum, x) => sum + x.quantity - x.filled, 0);
  const reservedCash = evidence.orders.filter(x => x.side === "BUY").reduce((sum, x) => sum + (x.quantity - x.filled) * x.price, 0);
  require(reservedBase <= base + 1e-10 && reservedCash <= cash + 1e-10, "PROVIDER_RESERVATIONS_EXCEED_BALANCE");
  const availableBase = evidence.balances.find(x => x.currency === baseline.baseCurrency)?.available ?? 0;
  const availableCash = evidence.balances.find(x => x.currency === baseline.quoteCurrency)?.available ?? 0;
  require(close(base - reservedBase, availableBase) && close(cash - reservedCash, availableCash), "UNEXPLAINED_FROZEN_BALANCE");
  return { cash, base, evidenceHash: deterministicDigest({ baseline, evidence, fills }) };
}
