import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {DemoTrialService} from "@/services/execution/demo-trial-service";
import {AccountStateService} from "@/services/execution/account-state-service";
import {ExecutionService} from "@/services/execution/service";
import * as evidence from "@/services/execution/demo-trial-evidence";
import {rebuildAccountLedgerV2} from "@/domain/account-ledger-v2";
import {executionClientOrderId} from "@/domain/execution";
import {HistoricalCandleService} from "@/services/candles/service";

const now="2026-09-19T12:00:00.000Z",started="2026-09-19T00:00:00.000Z";
function harness(){
  vi.spyOn(HistoricalCandleService.prototype,"sync").mockResolvedValue({provider:"okx-spot-candles",fetched:30,inserted:0,pages:1,nextCursor:null,status:"COMPLETED"});
  const common={accountId:"account",baselineAt:started,openingCashStatus:"DECLARED" as const,historyComplete:true,cutoffAt:now,dailyWindowStartAt:started,fills:[],pendingOrders:[],marks:[{instrumentId:"BTC-EUR",priceSek:1000000,observedAt:now,availableAt:now}]};
  const full=rebuildAccountLedgerV2({...common,openingCashSek:50000,openingInventory:[{instrumentId:"BTC-EUR",quantity:2,referencePriceSek:1000000}],demoReconciliation:{externalAccountId:"123",instrumentId:"BTC-EUR",quoteCurrency:"EUR",quoteSekRate:10,feeRate:.001,evidenceHash:"a".repeat(64),market:{baseCurrency:"BTC",quoteCurrency:"EUR",bid:100000,ask:100001,observedAt:now,lotSize:.00000001,minimumSize:.00001,tickSize:.1}}});
  const ledger=rebuildAccountLedgerV2({...common,openingCashSek:200});
  const proof={snapshotId:"snapshot",trialId:"trial",actionId:"",accountId:"account",enabled:true,riskSnapshotId:"risk",startedAt:started,endsAt:"2026-09-20T00:00:00Z",instrumentId:"BTC-EUR",ledger};
  vi.spyOn(evidence,"loadDemoTrialEvidence").mockResolvedValue(proof);
  vi.spyOn(AccountStateService.prototype,"capture").mockResolvedValue({riskStatus:"KNOWN"} as any);
  vi.spyOn(ExecutionService.prototype,"reconcile").mockResolvedValue({checked:0,mismatches:0,recovered:0});
  const create=vi.spyOn(ExecutionService.prototype,"createAndEvaluate").mockResolvedValue({decision:"PASSED",intentId:"intent",orderId:"order",evaluationId:"safety",requirements:[]});
  const submit=vi.spyOn(ExecutionService.prototype,"submitReady").mockResolvedValue({submitted:1,considered:1,blocked:0,unavailable:0});
  const bars=Array.from({length:30},(_,i)=>({id:String(i),closed_at:new Date(Date.parse(now)-(29-i)*300000).toISOString(),available_at:now,close:100+i,high:101+i,low:99+i,volume:10,raw_payload:{instrumentId:"BTC-EUR",quoteCurrency:"EUR",row:[0,0,0,0,0,0,0,0,"1"]}})).reverse();
  const state:any={execution_controls:{mode:"DEMO",provider:"okx-demo",live_execution_enabled:false,kill_switch:false,new_orders_enabled:true,limits:{maxOrderSek:100}},demo_trials:[{id:"trial",account_id:"account",asset_id:"asset",enabled:true,instrument_id:"BTC-EUR",started_at:started,ends_at:proof.endsAt}],market_candles:bars,risk_ledger_snapshots:{id:"risk",ledger_payload:full},demo_trial_orders:[],demo_trial_decisions:null};
  const writes:any[]=[];
  const db:any={from(table:string){const q:any={};let insert:any,single=false;for(const m of ["select","eq","in","lte","order","limit","gt"])q[m]=()=>q;
    q.single=q.maybeSingle=()=>{single=true;return q};q.insert=(row:any)=>{insert=row;return q};q.then=(resolve:any)=>Promise.resolve({data:insert?(writes.push(insert),{id:"decision"}):single&&Array.isArray(state[table])?state[table][0]??null:state[table],error:null}).then(resolve);return q;}};
  const provider:any={name:"okx-demo",mode:"DEMO",health:vi.fn(async()=>({status:"HEALTHY",credentialsValid:true,tradePermission:true,withdrawPermission:false})),cancelOrder:vi.fn()};
  return{service:new DemoTrialService(db,provider),create,submit,state,writes,full,proof,common};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now)});afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()});
describe("experimental demo orchestration",()=>{
  it("creates an explicitly unvalidated limited BUY and uses the existing final submission service",async()=>{
    const h=harness();expect((await h.service.run()).status).toBe("EXPERIMENTAL_ORDER");
    const [intent,context]=h.create.mock.calls[0];expect(intent).toMatchObject({sourceType:"demo_trial",sourceId:"decision",strategyAttributionId:null,side:"BUY",instrumentId:"BTC-EUR",orderType:"LIMIT"});
    expect(intent.quoteAmountSek).toBeLessThanOrEqual(100);expect(context.totalExposureSek).toBe(0);expect(context.availableCashSek).toBe(200);expect(h.submit).toHaveBeenCalledOnce();
  });
  it("does not turn a bearish setup into a sale of old inventory",async()=>{
    const h=harness();h.state.market_candles=h.state.market_candles.map((b:any,i:number)=>({...b,close:100+i,high:101+i,low:99+i}));
    expect((await h.service.run()).status).toBe("WAIT");expect(h.create).not.toHaveBeenCalled();
  });
  it("does not repeat a previously evaluated setup",async()=>{
    const h=harness();h.state.demo_trial_decisions={id:"old"};expect((await h.service.run()).status).toBe("ALREADY_EVALUATED");expect(h.create).not.toHaveBeenCalled();
  });
  it("exits only the fee-adjusted position bought by the trial",async()=>{
    const h=harness();h.proof.ledger=rebuildAccountLedgerV2({...h.common,openingCashSek:200,fills:[{fillId:"fill",accountId:"account",instrumentId:"BTC-EUR",side:"BUY",quantity:.0001,priceSek:1000000,feeSek:1,feeAsset:"BASE",feeBaseQuantity:.000001,occurredAt:now,availableAt:now}]});
    h.state.market_candles=h.state.market_candles.map((b:any,i:number)=>({...b,close:100+i,high:101+i,low:99+i}));
    expect(await h.service.run()).toMatchObject({status:"EXPERIMENTAL_ORDER",side:"SELL",reason:"TREND_EXIT"});
    const intent=h.create.mock.calls[0][0];expect(intent.quantity).toBeLessThanOrEqual(.000099);expect(intent.quantity).toBeGreaterThan(.000098);
    expect(intent.quoteAmountSek).toBeLessThanOrEqual(100);
  });
  it("stops new entries when the pilot window ends",async()=>{
    const h=harness();h.state.demo_trials[0].ends_at=now;expect(await h.service.run()).toMatchObject({status:"WAIT",reason:"TRIAL_ENDED"});expect(h.create).not.toHaveBeenCalled();
  });
  it("honors a global kill switch before account or provider activity",async()=>{
    const h=harness();h.state.execution_controls.kill_switch=true;expect((await h.service.run()).status).toBe("DISABLED");expect(h.create).not.toHaveBeenCalled();
  });
  it("uses deterministic exchange-compatible order identifiers",()=>{
    const id=executionClientOrderId("intent:example");expect(id).toMatch(/^[A-Za-z0-9]{32}$/);expect(id).toBe(executionClientOrderId("intent:example"));expect(id).not.toBe(executionClientOrderId("different"));
  });
});
