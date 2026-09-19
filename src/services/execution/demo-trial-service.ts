import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionProvider } from "./provider";
import { AccountStateService } from "./account-state-service";
import { ExecutionService } from "./service";
import { loadDemoTrialEvidence } from "./demo-trial-evidence";
import { demoTrialRisk, demoTrialSignal } from "@/domain/demo-trial";
import { deterministicDigest } from "@/domain/events";
import type { SafetyContext } from "@/domain/execution";

export class DemoTrialService {
  constructor(private db:SupabaseClient,private provider:ExecutionProvider){}
  async run(){
    if(this.provider.mode!=="DEMO"||this.provider.name!=="okx-demo")return{status:"DISABLED"};
    const control=await this.db.from("execution_controls").select("*").eq("control_key","global").single();
    if(control.error)throw control.error;
    if(control.data.mode!=="DEMO"||control.data.provider!=="okx-demo"||control.data.live_execution_enabled||control.data.kill_switch||!control.data.new_orders_enabled)return{status:"DISABLED"};
    const config=await this.db.from("demo_trials").select("*").eq("enabled",true).limit(2);
    if(config.error)throw config.error;
    if(!config.data?.length)return{status:"DISABLED"};
    if(config.data.length!==1)throw new Error("DEMO_TRIAL_SCOPE_AMBIGUOUS");
    const trial=config.data[0], execution=new ExecutionService(this.db,this.provider);
    await execution.reconcile();
    const active=await this.db.from("demo_trial_orders").select("id,client_order_id,provider_order_id,current_state,created_at").eq("trial_id",trial.id)
      .in("current_state",["SUBMITTED","ACKNOWLEDGED","PARTIALLY_FILLED","SUBMITTING","RECONCILIATION_REQUIRED"]);
    if(active.error)throw active.error;
    for(const order of active.data??[]){
      if(Date.now()-Date.parse(order.created_at)<60000)return{status:"ORDER_PENDING",orderId:order.id};
      if(!["ACKNOWLEDGED","PARTIALLY_FILLED","SUBMITTED"].includes(order.current_state))throw new Error("DEMO_TRIAL_ORDER_UNCERTAIN");
      await this.provider.cancelOrder(trial.instrument_id,order.client_order_id,order.provider_order_id);
    }
    if(active.data?.length)await execution.reconcile();
    const cutoff=new Date().toISOString();
    const candles=await this.db.from("market_candles").select("id,closed_at,available_at,close,high,low,volume,raw_payload")
      .eq("asset_id",trial.asset_id).eq("provider","okx-spot-candles").eq("timeframe","5m")
      .lte("closed_at",cutoff).lte("available_at",cutoff).order("closed_at",{ascending:false}).limit(288);
    if(candles.error)throw candles.error;
    const bars=(candles.data??[]).reverse();
    const signal=demoTrialSignal(bars.map(b=>({id:b.id,closedAt:new Date(b.closed_at).toISOString(),availableAt:new Date(b.available_at).toISOString(),
      close:Number(b.close),high:Number(b.high),low:Number(b.low),volume:Number(b.volume)})),cutoff);
    if(bars.some(b=>b.raw_payload?.quoteCurrency!=="EUR"||b.raw_payload?.instrumentId!=="BTC-EUR"||b.raw_payload?.row?.[8]!=="1"))throw new Error("DEMO_TRIAL_CANDLE_SOURCE_INVALID");
    // Capture after slow reads. Full account reconciliation is still mandatory.
    const capture=await new AccountStateService(this.db,this.provider).capture();
    if(capture.riskStatus!=="KNOWN")return{status:"ACCOUNT_UNKNOWN",capture};
    const read=await this.db.from("risk_ledger_snapshots").select("*").eq("account_id",trial.account_id)
      .order("information_cutoff_at",{ascending:false}).order("id",{ascending:false}).limit(1).single();
    if(read.error)throw read.error;
    const risk=read.data,full=risk.ledger_payload,evidence=await loadDemoTrialEvidence(this.db,trial,risk),scoped=demoTrialRisk(evidence,full);
    if(!scoped)return{status:"BUDGET_UNKNOWN"};
    const market=full.demoReconciliation?.market,fx=full.demoReconciliation?.quoteSekRate,fee=full.demoReconciliation?.feeRate;
    if(!market||![market.bid,market.ask,market.lotSize,market.minimumSize,market.tickSize,fx].every(v=>Number.isFinite(v)&&v>0)
      || !Number.isFinite(fee)||fee<0||fee>0.01||market.ask<market.bid)return{status:"MARKET_UNKNOWN"};
    const now=new Date().toISOString(),age=Date.parse(now)-Date.parse(market.observedAt);
    if(age<0||age>10000||(market.ask-market.bid)/market.bid*10000>50)return{status:"MARKET_STALE_OR_SPREAD"};
    const position=evidence.ledger.positions.find(p=>p.instrumentId===trial.instrument_id),held=scoped.availableSellQuantity?.["BTC-EUR"]??0;
    const lastBuy=await this.db.from("demo_trial_orders").select("action_at").eq("trial_id",trial.id)
      .in("current_state",["FILLED","PARTIALLY_FILLED","CANCELLED"]).gt("filled_quantity",0).eq("execution_intents->>side","BUY")
      .order("action_at",{ascending:false}).limit(1).maybeSingle();
    if(lastBuy.error)throw lastBuy.error;
    const entry=(position?.averageCostSek??0)/fx,expired=Date.parse(trial.ends_at)<=Date.parse(now);
    const timed=lastBuy.data&&Date.parse(now)-Date.parse(lastBuy.data.action_at)>=30*60000;
    const exit=held>=market.minimumSize&&(expired||timed||market.bid<=entry*.95||market.bid>=entry*1.1||signal.ready&&signal.bearish);
    const side=exit?"SELL":!expired&&signal.ready&&signal.bullish&&scoped.openPositions===0?"BUY":null;
    const reason=exit?expired?"TRIAL_ENDED_EXIT":timed?"MAX_HOLD_30M":market.bid<=entry*.95?"STOP_5_PERCENT":market.bid>=entry*1.1?"TARGET_10_PERCENT":"TREND_EXIT"
      :side?"EXPERIMENTAL_TREND_ENTRY":expired?"TRIAL_ENDED":scoped.openPositions?"HOLDING_TRIAL_POSITION":signal.ready?"WAITING_FOR_BULLISH_SETUP":signal.reason;
    const key=side==="SELL"?`SELL:${lastBuy.data?.action_at}:${held}:${reason}`:`${side??"WAIT"}:${signal.candleId??now.slice(0,16)}`;
    const found=await this.db.from("demo_trial_decisions").select("id").eq("trial_id",trial.id).eq("signal_key",key).maybeSingle();
    if(found.error)throw found.error;
    if(found.data)return{status:"ALREADY_EVALUATED",reason};
    const price=Number(((side==="SELL"?Math.floor(market.bid/market.tickSize):Math.ceil(market.ask/market.tickSize))*market.tickSize).toPrecision(14));
    const amount=Math.min(100,side==="SELL"?held*price*fx:scoped.availableCashSek!/(1+fee));
    const quantity=Number((Math.floor(amount/(price*fx)/market.lotSize)*market.lotSize).toPrecision(14)),notional=quantity*price*fx;
    const tradable=side!==null&&quantity>=market.minimumSize&&notional>=10&&notional<=100.00000001;
    const action=await this.db.from("demo_trial_decisions").insert({trial_id:trial.id,signal_key:key,decision:tradable?side:"WAIT",
      reason:side&&!tradable?"LOT_OR_BUDGET_LIMIT":reason,candle_id:signal.candleId,
      evidence:{label:"EXPERIMENTAL_UNVALIDATED",signal,riskSnapshotId:risk.id,trialSnapshotId:evidence.snapshotId,market,quantity,notional}}).select("id").single();
    if(action.error){if(action.error.code==="23505")return{status:"ALREADY_EVALUATED",reason};throw action.error;}
    if(!tradable)return{status:"WAIT",reason:side?"LOT_OR_BUDGET_LIMIT":reason};
    const health=await this.provider.health(),at=new Date().toISOString();
    const context:SafetyContext={mode:"DEMO",killSwitch:control.data.kill_switch,newOrdersEnabled:control.data.new_orders_enabled,liveExecutionEnabled:false,
      providerStatus:health.status,credentialsValid:health.credentialsValid,tradePermission:health.tradePermission,withdrawPermission:health.withdrawPermission,
      instrumentType:"SPOT",leverage:1,openPositions:scoped.openPositions,dailyLossSek:scoped.dailyLossSek,totalExposureSek:scoped.totalExposureSek,
      availableCashSek:scoped.availableCashSek,availableSellQuantity:held,dataAgeMs:Date.parse(at)-Date.parse(market.observedAt),
      criticalSafety:"PASS",liquidityStatus:"PASS",riskStatus:"PASS"};
    const result=await execution.createAndEvaluate({sourceType:"demo_trial",sourceId:action.data.id,assetId:trial.asset_id,instrumentId:trial.instrument_id,
      side:side!,orderType:"LIMIT",quoteAmountSek:notional,quantity,limitPrice:price,stopPrice:price*.95,targetPrice:price*1.1,maxSlippageBps:50,
      informationCutoffAt:at,availableAt:at,expiresAt:new Date(Date.parse(at)+60000).toISOString(),
      evidenceRefs:[`experimental-demo:${trial.id}`,`trial-decision:${action.data.id}`,`trial-snapshot:${evidence.snapshotId}`,`signal:${deterministicDigest(signal)}`],
      consensusVersion:null,forecastVersion:null,riskVersion:"account-ledger-v2",strategyAttributionId:null},context,control.data.limits);
    const submitted=await execution.submitReady(1);
    return{status:"EXPERIMENTAL_ORDER",side,reason,notional,...result,submitted};
  }
}
