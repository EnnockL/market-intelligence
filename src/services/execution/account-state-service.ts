import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { rebuildRiskLedger } from "@/domain/risk-ledger";
import { FxRepository } from "@/services/fx/repository";
import type { ExecutionProvider } from "./provider";

const n=(value:unknown)=>value===null||value===undefined?null:Number(value);
export class AccountStateService{
  constructor(private db:SupabaseClient,private provider:ExecutionProvider){}
  async capture(cutoffAt=new Date().toISOString()){
    const accountKey=this.provider.mode==="SHADOW"?"shadow-primary":`${this.provider.name}-primary`,accountRow=await this.db.from("execution_accounts").upsert({account_key:accountKey,provider:this.provider.name,provider_environment:this.provider.mode,status:"ACTIVE"},{onConflict:"account_key"}).select("*").single();if(accountRow.error)throw accountRow.error;
    const providerState=await this.provider.getAccountState(),availableAt=new Date().toISOString(),payload={balances:providerState.balances,positions:providerState.positions,totalEquityUsd:providerState.totalEquityUsd,availableQuoteUsd:providerState.availableQuoteUsd,status:providerState.status,unknownReasons:providerState.unknownReasons,observedAt:providerState.observedAt},payloadHash=deterministicDigest(payload),observationKey=deterministicDigest({accountId:accountRow.data.id,provider:this.provider.name,payloadHash,observedAt:providerState.observedAt});
    const observation=await this.db.from("account_state_observations").upsert({observation_key:observationKey,account_id:accountRow.data.id,provider:this.provider.name,provider_environment:this.provider.mode,balances:providerState.balances,positions:providerState.positions,total_equity_usd:providerState.totalEquityUsd,available_quote_usd:providerState.availableQuoteUsd,data_status:providerState.status,unknown_reasons:providerState.unknownReasons,observed_at:providerState.observedAt,available_at:availableAt,source_reference:providerState.sourceReference,payload_hash:payloadHash},{onConflict:"observation_key",ignoreDuplicates:true});if(observation.error)throw observation.error;
    const dayStart=new Date(cutoffAt);dayStart.setUTCHours(0,0,0,0);const fills=await this.db.from("execution_fills").select("id,quantity,price,fee_amount,fee_currency,occurred_at,available_at,execution_orders!inner(execution_intents!inner(side,instrument_id))").gte("occurred_at",dayStart.toISOString()).lte("available_at",cutoffAt).order("occurred_at");if(fills.error)throw fills.error;
    const pending=await this.db.from("execution_orders").select("current_state,execution_intents!inner(quote_amount_sek)").in("current_state",["SAFETY_PASSED","SUBMITTING","SUBMITTED","ACKNOWLEDGED","PARTIALLY_FILLED"]);if(pending.error)throw pending.error;const reserved=(pending.data??[]).reduce((sum,row:any)=>sum+Number((Array.isArray(row.execution_intents)?row.execution_intents[0]:row.execution_intents)?.quote_amount_sek??0),0);
    const normalized=(fills.data??[]).map((x:any)=>{const order=Array.isArray(x.execution_orders)?x.execution_orders[0]:x.execution_orders,intent=Array.isArray(order?.execution_intents)?order.execution_intents[0]:order?.execution_intents,sekQuoted=String(intent?.instrument_id??"").endsWith("-SEK");return{fillId:x.id,side:intent?.side as "BUY"|"SELL",quantity:Number(x.quantity),priceSek:sekQuoted?n(x.price):null,feeSek:x.fee_currency==="SEK"?n(x.fee_amount):x.fee_amount===null?0:null,occurredAt:x.occurred_at,availableAt:x.available_at}});
    let initialCashSek=n(accountRow.data.initial_cash_sek);
    if(this.provider.mode==="DEMO"&&initialCashSek===null&&providerState.availableQuoteUsd!==null){
      const fx=await new FxRepository(this.db).lookup("USD","SEK",providerState.observedAt,availableAt);
      if(fx.status==="FOUND"){
        initialCashSek=providerState.availableQuoteUsd*fx.observation.rate;
        const initialized=await this.db.from("execution_accounts").update({initial_cash_sek:initialCashSek,base_currency:"SEK"}).eq("id",accountRow.data.id).is("initial_cash_sek",null);
        if(initialized.error)throw initialized.error;
      }
    }
    const snapshot=rebuildRiskLedger({accountId:accountRow.data.id,initialCashSek,fills:normalized,reservedExposureSek:reserved,cutoffAt});
    const saved=await this.db.from("risk_ledger_snapshots").upsert({snapshot_key:snapshot.snapshotKey,account_id:accountRow.data.id,ledger_version:snapshot.version,status:snapshot.status,cash_sek:snapshot.cashSek,open_positions:snapshot.openPositions,open_quantity:snapshot.openQuantity,average_cost_sek:snapshot.averageCostSek,realized_pnl_sek:snapshot.realizedPnlSek,fees_sek:snapshot.feesSek,reserved_exposure_sek:snapshot.reservedExposureSek,unknown_reasons:snapshot.unknownReasons,source_fill_ids:normalized.map(x=>x.fillId),information_cutoff_at:cutoffAt,available_at:availableAt,result_hash:snapshot.resultHash},{onConflict:"snapshot_key",ignoreDuplicates:true});if(saved.error)throw saved.error;
    return{accountKey,providerStatus:providerState.status,riskStatus:snapshot.status,cashSek:snapshot.cashSek,openPositions:snapshot.openPositions,reservedExposureSek:snapshot.reservedExposureSek,unknownReasons:snapshot.unknownReasons};
  }
}
