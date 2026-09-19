import { deterministicDigest } from "./events";
import { verifyAccountLedgerV2Snapshot, type AccountLedgerSnapshotV2 } from "./account-ledger-v2";
import type { evaluateProposalCandidate, ProposalCandidateInput } from "./trade-proposal-producer";

export interface DemoExecutionMarket {
  baseCurrency: string; quoteCurrency: string; lotSize: number; minimumSize: number; tickSize: number;
  bid: number; ask: number; observedAt: string;
}
/** Bind a qualified proposal to the actual account venue and native quote. */
export function mapDemoProposal(input: ProposalCandidateInput, candidate: ReturnType<typeof evaluateProposalCandidate>, snapshot: AccountLedgerSnapshotV2 | null) {
  const fail = (reason: string) => ({ ...candidate, decision: candidate.decision === "REJECTED" ? "REJECTED" as const : "DATA_BLOCKED" as const,
    orderType: "LIMIT" as const, limitPrice: null, quoteAmountSek: null,
    requirements: [...candidate.requirements,{code:"DEMO_MARKET_EXECUTION",status:"UNKNOWN" as const,observedValue:reason,requiredValue:"CURRENT_ACCOUNT_MARKET",blockerCode:reason}],
    resultHash: deterministicDigest({ inputHash:candidate.resultHash, reason }) });
  if (!snapshot || !verifyAccountLedgerV2Snapshot(snapshot) || snapshot.status !== "KNOWN") return fail("DEMO_ACCOUNT_MARKET_UNKNOWN");
  const e=snapshot.demoReconciliation, m=e?.market;
  if (!e || !m || input.assetKind!=="crypto" || input.symbol.toUpperCase()!==m.baseCurrency
    || e.instrumentId!==`${m.baseCurrency}-${m.quoteCurrency}` || e.quoteCurrency!==m.quoteCurrency) return fail("DEMO_INSTRUMENT_NOT_BOUND");
  const age=Date.parse(input.cutoffAt)-Date.parse(m.observedAt);
  if (!Number.isFinite(age) || age<0 || age>15000 || Date.parse(snapshot.cutoffAt)>Date.parse(input.cutoffAt)) return fail("DEMO_MARKET_STALE");
  if (![m.lotSize,m.minimumSize,m.tickSize,m.bid,m.ask,e.quoteSekRate].every(x=>Number.isFinite(x)&&x>0)
    || m.ask<m.bid || (m.ask-m.bid)/m.bid*10000>50 || !candidate.direction) return fail("DEMO_MARKET_RULES_UNKNOWN");
  const raw=candidate.direction==="BUY"?m.ask:m.bid;
  const price=(candidate.direction==="BUY"?Math.ceil(raw/m.tickSize):Math.floor(raw/m.tickSize))*m.tickSize;
  if (Math.abs(price/raw-1)*10000>50) return fail("DEMO_TICK_SLIPPAGE_LIMIT");
  const quantity=Math.floor(100/(price*e.quoteSekRate)/m.lotSize)*m.lotSize;
  const notional=quantity*price*e.quoteSekRate;
  if (!Number.isFinite(quantity) || quantity<m.minimumSize || notional<10 || notional>100.00000001) return fail("DEMO_LOT_SIZE_OUT_OF_RANGE");
  const result={...candidate,policyVersion:"demo-market-proposal-v1",orderType:"LIMIT" as const,instrument:e.instrumentId,referencePrice:price,limitPrice:price,quantity,quoteAmountSek:notional,dataAgeMs:age,
    stopPrice:candidate.direction==="BUY"?price*.95:price*1.05,targetPrice:candidate.direction==="BUY"?price*1.1:price*.9,
    evidenceRefs:[...candidate.evidenceRefs,`account-ledger:${snapshot.snapshotKey}`],
    requirements:[...candidate.requirements,{code:"DEMO_MARKET_EXECUTION",status:"PASS" as const,observedValue:e.instrumentId,requiredValue:"CURRENT_ACCOUNT_MARKET",blockerCode:null}]};
  return {...result,resultHash:deterministicDigest(result)};
}
