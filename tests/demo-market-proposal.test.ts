import { describe,expect,it } from "vitest";
import { mapDemoProposal } from "@/domain/demo-market-proposal";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";
import { evaluateProposalCandidate, type ProposalCandidateInput } from "@/domain/trade-proposal-producer";
const at="2026-09-19T12:00:00.000Z";
const input:ProposalCandidateInput={opportunityId:"o",assetId:"a",assetKind:"crypto",symbol:"BTC",opportunityState:"qualified",metaAssessmentId:"m",metaReady:true,metaDecision:"WATCH",metaAvailableAt:at,consensusId:"c",consensusResult:"BULLISH",consensusAvailableAt:at,priceId:"p",priceUsd:60000,priceAvailableAt:at,fxId:"f",usdSek:10,fxAvailableAt:at,liquidityId:"l",liquidityUsd:100000,liquidityAvailableAt:at,riskId:"r",riskStatus:"LOW_RISK",riskAvailableAt:at,cutoffAt:at};
function ledger(change={}){return rebuildAccountLedgerV2({accountId:"a",baselineAt:at,openingCashSek:1000,openingCashStatus:"DECLARED",historyComplete:true,cutoffAt:at,dailyWindowStartAt:at,fills:[],marks:[],pendingOrders:[],demoReconciliation:{externalAccountId:"123",instrumentId:"BTC-EUR",quoteCurrency:"EUR",quoteSekRate:11,feeRate:.0035,evidenceHash:"a".repeat(64),market:{baseCurrency:"BTC",quoteCurrency:"EUR",lotSize:.00001,minimumSize:.00001,tickSize:.1,bid:50000,ask:50001,observedAt:at,...change}}});}
describe("account-bound EUR proposals",()=>{
 it("sizes a LIMIT using actual EUR quotes, exact FX and venue lot size",()=>{
  const r=mapDemoProposal(input,evaluateProposalCandidate(input),ledger());
  expect(r).toMatchObject({decision:"PROPOSAL_READY",instrument:"BTC-EUR",orderType:"LIMIT",limitPrice:50001});
  expect(r.quoteAmountSek).toBeCloseTo(r.quantity!*r.limitPrice!*11);
  expect(r.quoteAmountSek).toBeLessThanOrEqual(100);expect(r.quantity!/.00001).toBeCloseTo(Math.round(r.quantity!/.00001));
 });
 it.each([{ask:60000},{lotSize:1},{tickSize:100000},{observedAt:"2026-09-19T11:59:00Z"}])("blocks stale or untradeable venue evidence %j",change=>expect(mapDemoProposal(input,evaluateProposalCandidate(input),ledger(change)).decision).toBe("DATA_BLOCKED"));
 it("does not promote rejected research or another asset by changing its currency",()=>{
  const rejected={...input,opportunityState:"watch"};
  expect(mapDemoProposal(rejected,evaluateProposalCandidate(rejected),ledger()).decision).toBe("REJECTED");
  expect(mapDemoProposal({...input,symbol:"ETH"},evaluateProposalCandidate(input),ledger()).decision).toBe("DATA_BLOCKED");
 });
});
