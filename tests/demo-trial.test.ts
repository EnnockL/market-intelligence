import { describe,it,expect } from "vitest";
import { demoTrialRisk,demoTrialSignal,type DemoTrialEvidence } from "@/domain/demo-trial";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";
import { evaluateSubmissionEvidence } from "@/domain/execution-submission";
import { submissionFixture } from "./support/execution-submission-fixture";

const at="2026-09-07T12:00:00.000Z",start="2026-09-01T00:00:00.000Z";
function setup(){
  const common={accountId:"account-1",baselineAt:start,openingCashStatus:"DECLARED" as const,historyComplete:true,cutoffAt:at,dailyWindowStartAt:"2026-09-07T00:00:00.000Z",fills:[],pendingOrders:[],
    marks:[{instrumentId:"BTC-EUR",priceSek:1000000,observedAt:at,availableAt:at}]};
  const full=rebuildAccountLedgerV2({...common,openingCashSek:50000,openingInventory:[{instrumentId:"BTC-EUR",quantity:2,referencePriceSek:1000000}],
    demoReconciliation:{externalAccountId:"123",instrumentId:"BTC-EUR",quoteCurrency:"EUR",quoteSekRate:10,feeRate:.001,evidenceHash:"a".repeat(64),
      market:{baseCurrency:"BTC",quoteCurrency:"EUR",bid:100000,ask:100001,observedAt:at,lotSize:.00000001,minimumSize:.00001,tickSize:.1}}});
  const ledger=rebuildAccountLedgerV2({...common,openingCashSek:200});
  const trial:DemoTrialEvidence={snapshotId:"trial-snapshot",trialId:"trial",actionId:"action",accountId:"account-1",enabled:true,riskSnapshotId:"risk-1",startedAt:start,endsAt:"2026-09-08T00:00:00Z",instrumentId:"BTC-EUR",ledger};
  return{common,full,trial};
}
describe("experimental demo budget",()=>{
  it("keeps pre-existing inventory valued but unavailable to trial sales",()=>{
    const {full,trial}=setup();const risk=demoTrialRisk(trial,full)!;
    expect(full.grossExposureSek).toBe(2000000);expect(risk.totalExposureSek).toBe(0);
    expect(risk.availableCashSek).toBe(200);expect(risk.availableSellQuantity["BTC-EUR"]).toBe(0);
  });
  it("blocks malformed, disabled, wrong-account and stale-cutoff projections",()=>{
    const {full,trial}=setup();
    for(const patch of [{enabled:false},{accountId:"other"},{ledger:{...trial.ledger,cashSek:50000}},{ledger:{...trial.ledger,cutoffAt:"2026-09-07T11:59:00Z"}}])expect(demoTrialRisk({...trial,...patch},full)).toBeNull();
  });
  it("counts actual fee-adjusted trial inventory and all other reservations",()=>{
    const {common,full,trial}=setup();trial.ledger=rebuildAccountLedgerV2({...common,openingCashSek:200,
      fills:[{fillId:"fill",accountId:"account-1",instrumentId:"BTC-EUR",side:"BUY",quantity:.0001,priceSek:1000000,feeSek:1,feeAsset:"BASE",feeBaseQuantity:.000001,occurredAt:at,availableAt:at}],
      pendingOrders:[{orderId:"other",accountId:"account-1",instrumentId:"BTC-EUR",side:"SELL",remainingQuantity:.00005,remainingNotionalSek:null,availableAt:at}]});
    const risk=demoTrialRisk(trial,full)!;
    expect(risk.totalExposureSek).toBeCloseTo(99);expect(risk.availableCashSek).toBe(100);
    expect(risk.availableSellQuantity["BTC-EUR"]).toBeCloseTo(.000049);
  });
  it("requires trial identity at final guard and never authorizes sales of old BTC",()=>{
    const f=submissionFixture("DEMO"),{full,trial}=setup();
    Object.assign(f.risk as object,{ledger_payload:full,status:full.status,cash_sek:full.cashSek,open_positions:full.openPositions,realized_pnl_sek:full.realizedPnlSek,reserved_exposure_sek:full.reservedBuySek});
    Object.assign(f.intent,{sourceType:"demo_trial",sourceId:"action",instrumentId:"BTC-EUR",quantity:.0001,limitPrice:100000});f.trial=trial;
    expect(evaluateSubmissionEvidence(f).decision).toBe("PASSED");
    f.intent.side="SELL";expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_SELL_QUANTITY_UNAVAILABLE");
    f.intent.side="BUY";f.trial=undefined;expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_DEMO_TRIAL_SCOPE");
    f.trial=trial;f.intent.sourceType="trade_eligibility";expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_DEMO_TRIAL_SCOPE");
  });
  it("still honors global stop and unknown full account",()=>{
    const f=submissionFixture("DEMO");f.intent.sourceType="demo_trial";f.trial=setup().trial;
    (f.control as any).kill_switch=true;expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_KILL_SWITCH_ACTIVE");
    (f.control as any).kill_switch=false;(f.risk as any).status="UNKNOWN";expect(evaluateSubmissionEvidence(f).reason).toBe("FINAL_RISK_UNKNOWN");
  });
});
describe("prospective demo entry signal",()=>{
  const bars=Array.from({length:30},(_,i)=>({id:String(i),closedAt:new Date(Date.parse(at)-(29-i)*300000).toISOString(),availableAt:at,close:100+i,high:101+i,low:99+i,volume:10}));
  it("uses completed contiguous evidence for an experimental trend",()=>expect(demoTrialSignal(bars,at)).toMatchObject({ready:true,bullish:true,candleId:"29"}));
  it("does not fill stale, missing, zero-volume or future evidence with a signal",()=>{
    for(const broken of [bars.slice(0,15),bars.filter((_,i)=>i!==20),bars.map(b=>({...b,volume:0})),bars.map(b=>({...b,availableAt:"2026-09-08T00:00:00Z"}))])expect(demoTrialSignal(broken,at).ready).toBe(false);
    expect(demoTrialSignal(bars,"2026-09-07T12:11:00Z").ready).toBe(false);
  });
});
