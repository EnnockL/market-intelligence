import { describe,expect,it } from "vitest";
import { mapDemoProposal } from "@/domain/demo-market-proposal";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";
import { evaluateProposalCandidate, type ProposalCandidateInput } from "@/domain/trade-proposal-producer";
import { evaluateTradeEligibility, type TradeProposal } from "@/domain/trade-eligibility";
import { createExecutionIntent } from "@/domain/execution";
const at="2026-09-19T12:00:00.000Z";
const input:ProposalCandidateInput={opportunityId:"o",assetId:"a",assetKind:"crypto",symbol:"BTC",assetExternalId:"bitcoin",assetMetadata:{nativeAsset:true,chain:"bitcoin",executionInstrument:"BTC-EUR"},opportunityState:"qualified",metaAssessmentId:"m",metaReady:true,metaDecision:"WATCH",metaAvailableAt:at,consensusId:"c",consensusResult:"BULLISH",consensusAvailableAt:at,priceId:"p",priceUsd:60000,priceAvailableAt:at,fxId:"f",usdSek:10,fxAvailableAt:at,liquidityId:"l",liquidityUsd:100000,liquidityAvailableAt:at,riskId:"r",riskStatus:"LOW_RISK",riskAvailableAt:at,cutoffAt:at};
function ledger(change={}){return rebuildAccountLedgerV2({accountId:"a",baselineAt:at,openingCashSek:1000,openingCashStatus:"DECLARED",historyComplete:true,cutoffAt:at,dailyWindowStartAt:at,fills:[],marks:[],pendingOrders:[],demoReconciliation:{externalAccountId:"123",instrumentId:"BTC-EUR",quoteCurrency:"EUR",quoteSekRate:11,feeRate:.0035,evidenceHash:"a".repeat(64),market:{baseCurrency:"BTC",quoteCurrency:"EUR",lotSize:.00001,minimumSize:.00001,tickSize:.1,bid:50000,ask:50001,observedAt:at,...change}}});}
describe("account-bound EUR proposals",()=>{
 it.each([
  {assetExternalId:null},
  {assetMetadata:{nativeAsset:true,chain:"solana",executionInstrument:"BTC-EUR"}},
  {assetMetadata:{nativeAsset:false,chain:"bitcoin",executionInstrument:"BTC-EUR"}},
  {assetMetadata:{nativeAsset:true,chain:"bitcoin",executionInstrument:"BTC-USDT"}},
 ])("rejects an unverified or same-ticker asset %j",change=>{
  const changed={...input,...change};
  const result=mapDemoProposal(changed,evaluateProposalCandidate(changed),ledger());
  expect(result.decision).toBe("DATA_BLOCKED");
  expect(result.requirements.at(-1)?.blockerCode).toBe("DEMO_ASSET_IDENTITY_UNVERIFIED");
 });
 it.each(["BULLISH","BEARISH"])("preserves EUR prices and SEK value through eligibility and intent for %s",consensusResult=>{
  const candidateInput={...input,consensusResult};
  const mapped=mapDemoProposal(candidateInput,evaluateProposalCandidate(candidateInput),ledger());
  const proposal:TradeProposal={proposalId:"proposal",assetId:input.assetId,sourceType:"trade_proposal_policy",sourceId:"opportunity",
   instrumentId:mapped.instrument,side:mapped.direction as "BUY"|"SELL",orderType:mapped.orderType,quoteAmountSek:mapped.quoteAmountSek,
   quantity:mapped.quantity,referencePrice:mapped.referencePrice,limitPrice:mapped.limitPrice,stopPrice:mapped.stopPrice,targetPrice:mapped.targetPrice,
   maxSlippageBps:50,informationCutoffAt:at,availableAt:at,expiresAt:"2026-09-19T12:01:00.000Z",metaReady:true,
   directionalSupport:consensusResult as "BULLISH"|"BEARISH",criticalSafety:"PASS",liquidityStatus:"PASS",riskStatus:"PASS",dataAgeMs:mapped.dataAgeMs,evidenceRefs:mapped.evidenceRefs};
  expect(evaluateTradeEligibility(proposal).decision).toBe("ELIGIBLE");
  const intent=createExecutionIntent({...proposal,sourceType:"trade_eligibility",sourceId:"evaluation",instrumentId:proposal.instrumentId!,quoteAmountSek:proposal.quoteAmountSek!,maxSlippageBps:50,consensusVersion:null,forecastVersion:null,riskVersion:"account-ledger-v2"});
  expect(intent.instrumentId).toBe("BTC-EUR");expect(intent.orderType).toBe("LIMIT");
  expect(intent.limitPrice).toBe(consensusResult==="BULLISH"?50001:50000);
  expect(intent.quoteAmountSek).toBeCloseTo(intent.quantity!*intent.limitPrice!*11);
  expect(intent.quoteAmountSek).toBeLessThanOrEqual(100);
  expect(intent.evidenceRefs).toContain("venue-asset:a:bitcoin:BTC-EUR");
 });
 it("retains unknown research and stale source-price blockers even with a fresh EUR venue",()=>{
  for(const change of [{metaReady:null},{priceAvailableAt:"2026-09-19T11:59:00Z"},{riskStatus:"HIGH_RISK"}]){
   const changed={...input,...change};
   const before=evaluateProposalCandidate(changed),after=mapDemoProposal(changed,before,ledger());
   expect(after.decision).toBe(before.decision);expect(after.decision).not.toBe("PROPOSAL_READY");
  }
 });
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
