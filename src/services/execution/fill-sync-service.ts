import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import type { ExecutionProvider, ProviderFillPage } from "./provider";

export type ExecutionFillSyncStatus = "COMPLETE_WINDOW" | "PARTIAL" | "RETENTION_GAP" | "UNSUPPORTED" | "FAILED";
export interface ExecutionFillSyncResult {status:ExecutionFillSyncStatus;checkpointId:string|null;inserted:number;pages:number;reason:string|null}
export interface ExecutionFillSyncInput {accountId:string;windowStart:string;windowEnd:string;maxPages?:number;pageSize?:number}

/** Read-only provider ingestion. COMPLETE_WINDOW attests to ts pagination only;
 * it says nothing about funding, older retention, account baseline, or all fills
 * of an order. Consumers must independently reconcile order accFillSz, including
 * cancelled partial orders, against the immutable account-scoped fill facts.
 */
export class ExecutionFillSyncService {
  constructor(private db:SupabaseClient,private provider:ExecutionProvider){}

  async syncAccount(input:ExecutionFillSyncInput):Promise<ExecutionFillSyncResult>{
    const maxPages=input.maxPages??3,pageSize=input.pageSize??100,start=Date.parse(input.windowStart),end=Date.parse(input.windowEnd);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.accountId)||!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>Date.now()||!Number.isInteger(maxPages)||maxPages<1||maxPages>10||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)return{status:"FAILED",checkpointId:null,inserted:0,pages:0,reason:"FILL_SYNC_INPUT_INVALID"};
    const requestedStart=new Date(start).toISOString(),requestedEnd=new Date(end).toISOString();
    const scope={account_id:input.accountId,provider:this.provider.name,provider_environment:this.provider.mode,requested_start_at:requestedStart,requested_end_at:requestedEnd};
    const syncKey=deterministicDigest(scope);
    let checkpointId:string|null=null,cursor:string|null=null,inserted=0,pages=0,effectiveStart=requestedStart,retentionLimited=false;
    const result=(status:ExecutionFillSyncStatus,reason:string|null=null):ExecutionFillSyncResult=>({status,checkpointId,inserted,pages,reason});
    try{
      const account=await this.db.from("execution_accounts").select("id,provider,provider_environment").eq("id",input.accountId).single();
      if(account.error||!account.data||account.data.provider!==this.provider.name||account.data.provider_environment!==this.provider.mode)return result("FAILED","FILL_SYNC_ACCOUNT_SCOPE_UNKNOWN");
      const saved=await this.db.from("execution_fill_sync_states").select("*").eq("sync_key",syncKey).maybeSingle();
      if(saved.error)return result("FAILED","FILL_SYNC_CHECKPOINT_UNAVAILABLE");
      if(saved.data){
        const state=saved.data;
        checkpointId=state.id;cursor=state.cursor_after_bill_id;effectiveStart=state.effective_start_at??requestedStart;retentionLimited=state.retention_limited===true;
        if(state.exhausted===true)return result(retentionLimited?"RETENTION_GAP":"COMPLETE_WINDOW",retentionLimited?"PROVIDER_RETENTION_LIMIT":null);
        if(state.status==="RETENTION_GAP"&&Date.parse(effectiveStart)>end)return result("RETENTION_GAP","PROVIDER_RETENTION_LIMIT");
      }
      const persist=async(page:Record<string,unknown>)=>{
        const response=await this.db.rpc("persist_execution_fill_page",{p_page:{...scope,sync_key:syncKey,request_cursor:cursor,page_size:pageSize,...page}});
        if(response.error||!response.data||typeof response.data!=="object"||response.data.ok!==true)throw new Error("FILL_SYNC_PERSISTENCE_FAILED");
        checkpointId=response.data.checkpoint_id;return response.data as {checkpoint_id:string;inserted:number;cursor_after_bill_id:string|null;status:ExecutionFillSyncStatus;exhausted:boolean};
      };
      const failure=async(status:"FAILED"|"UNSUPPORTED",reason:string)=>{
        try{await persist({status,reason,observed_at:new Date().toISOString(),fills:[]})}catch{return result("FAILED","FILL_SYNC_PERSISTENCE_FAILED")}
        return result(status,reason);
      };
      if(!this.provider.getFillsPage)return failure("UNSUPPORTED","PROVIDER_FILL_HISTORY_UNSUPPORTED");
      for(let pageNumber=0;pageNumber<maxPages;pageNumber++){
        let page:ProviderFillPage;
        try{page=await this.provider.getFillsPage({windowStart:effectiveStart,windowEnd:requestedEnd,afterBillId:cursor,limit:pageSize})}catch{return failure("FAILED","PROVIDER_FILL_PAGE_UNAVAILABLE")}
        if(page.status==="UNSUPPORTED")return failure("UNSUPPORTED","PROVIDER_FILL_HISTORY_UNSUPPORTED");
        const window=page.window;
        if(window.source!=="OKX_FILLS_HISTORY_3_MONTHS"||window.timeBasis!=="PROVIDER_RECORDED_AT"||!Number.isFinite(Date.parse(window.effectiveStart))||Date.parse(window.effectiveEnd)!==end||Date.parse(window.effectiveStart)<start||page.fills.length>pageSize||(page.exhausted&&(page.nextCursor!==null||page.fills.length>=pageSize))||(!page.exhausted&&Date.parse(window.effectiveStart)<=end&&(page.fills.length!==pageSize||!page.nextCursor||page.nextCursor===cursor))||(page.nextCursor!==null&&!/^[1-9][0-9]{0,39}$/.test(page.nextCursor)))return failure("FAILED","PROVIDER_FILL_PAGE_INVALID");
        // A resumed historical window crossing retention cannot claim the lost
        // segment was scanned. The RPC retains the original requested bounds.
        retentionLimited=retentionLimited||window.retentionLimited||Date.parse(window.effectiveStart)>start;
        effectiveStart=window.effectiveStart;
        const status:ExecutionFillSyncStatus=page.exhausted?(retentionLimited?"RETENTION_GAP":"COMPLETE_WINDOW"):(retentionLimited&&Date.parse(effectiveStart)>end?"RETENTION_GAP":"PARTIAL");
        const stored=await persist({status,reason:retentionLimited?"PROVIDER_RETENTION_LIMIT":null,effective_start_at:effectiveStart,effective_end_at:requestedEnd,retention_start_at:window.retentionStart,retention_limited:retentionLimited,source:window.source,time_basis:window.timeBasis,observed_at:page.observedAt,next_cursor:page.nextCursor,exhausted:page.exhausted,fills:page.fills});
        inserted+=stored.inserted;pages++;cursor=stored.cursor_after_bill_id;
        if(stored.exhausted||status==="RETENTION_GAP")return result(stored.status,retentionLimited?"PROVIDER_RETENTION_LIMIT":null);
        // OKX history is 10 requests / 2 seconds per user. Bound each run and
        // space its pages; concurrent clients can still return an explicit 429.
        if(pageNumber+1<maxPages)await new Promise(resolve=>setTimeout(resolve,210));
      }
      return result("PARTIAL","PAGE_BUDGET_EXHAUSTED");
    }catch{return result("FAILED","FILL_SYNC_PERSISTENCE_OR_STATE_UNKNOWN")}
  }
}
