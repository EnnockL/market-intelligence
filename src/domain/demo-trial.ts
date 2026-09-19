import { riskContextFromAccountLedgerV2, verifyAccountLedgerV2Snapshot, type AccountLedgerSnapshotV2 } from "./account-ledger-v2";

export interface DemoTrialEvidence {
  snapshotId: string; trialId: string; actionId: string; accountId: string; enabled: boolean;
  riskSnapshotId: string; startedAt: string; endsAt: string; instrumentId: string;
  ledger: AccountLedgerSnapshotV2;
}

/** An isolated cash allocation, never a revaluation/removal of existing holdings. */
export function demoTrialRisk(e: DemoTrialEvidence, full: AccountLedgerSnapshotV2, excludeOrderId: string | null = null) {
  if (!e.enabled || e.instrumentId !== "BTC-EUR" || !verifyAccountLedgerV2Snapshot(e.ledger) || !verifyAccountLedgerV2Snapshot(full)
    || e.accountId !== full.accountId || e.ledger.accountId !== full.accountId || e.ledger.status !== "KNOWN" || full.status !== "KNOWN"
    || e.ledger.pnlScope || e.ledger.baselineAt !== e.startedAt || e.ledger.cutoffAt !== full.cutoffAt
    || e.ledger.economicCutoffAt !== full.economicCutoffAt || e.ledger.positions.some(p => p.instrumentId !== e.instrumentId)) return null;
  const scoped = riskContextFromAccountLedgerV2(e.ledger, excludeOrderId), account = riskContextFromAccountLedgerV2(full, excludeOrderId);
  if (scoped.status !== "KNOWN" || account.status !== "KNOWN") return null;
  const minimum=full.demoReconciliation?.market?.minimumSize;
  const dust=typeof minimum==="number"&&minimum>0&&e.ledger.positions.every(p=>p.quantity!==null&&p.quantity<minimum);
  return { ...scoped, openPositions:dust?0:scoped.openPositions, availableCashSek: Math.min(scoped.availableCashSek!, account.availableCashSek!),
    availableSellQuantity: { [e.instrumentId]: Math.min(scoped.availableSellQuantity?.[e.instrumentId] ?? 0, account.availableSellQuantity?.[e.instrumentId] ?? 0) } };
}

export interface TrialBar { id: string; closedAt: string; availableAt: string; close: number; high: number; low: number; volume: number }
export function demoTrialSignal(bars: TrialBar[], now: string) {
  const invalid = { ready: false, bullish: false, bearish: false, candleId: null as string | null, reason: "CANDLE_EVIDENCE_INCOMPLETE" };
  if (bars.length < 20 || bars.some(b => ![b.close,b.high,b.low,b.volume].every(Number.isFinite) || b.close <= 0 || b.volume < 0
    || b.high < b.low || b.close > b.high || b.close < b.low || !Number.isFinite(Date.parse(b.closedAt)) || !Number.isFinite(Date.parse(b.availableAt))
    || Date.parse(b.availableAt) > Date.parse(now) || Date.parse(b.closedAt) > Date.parse(now))) return invalid;
  for (let i=1;i<bars.length;i++) if (Date.parse(bars[i].closedAt)-Date.parse(bars[i-1].closedAt)!==300000) return invalid;
  const last=bars.at(-1)!;
  if (Date.parse(now)-Date.parse(last.closedAt)>600000) return {...invalid, reason:"CANDLES_STALE"};
  const ema=(period:number)=>bars.reduce((v,b,i)=>i===0?b.close:b.close*(2/(period+1))+v*(1-2/(period+1)),0);
  const session=bars.filter(b=>b.closedAt.slice(0,10)===last.closedAt.slice(0,10)), volume=session.reduce((v,b)=>v+b.volume,0);
  if (!(volume>0)) return invalid;
  const vwap=session.reduce((v,b)=>v+(b.high+b.low+b.close)/3*b.volume,0)/volume, fast=ema(9),slow=ema(20);
  return {ready:true,bullish:fast>slow&&last.close>vwap,bearish:fast<slow,candleId:last.id,reason:"EXPERIMENTAL_EMA9_20_VWAP",fast,slow,vwap};
}
