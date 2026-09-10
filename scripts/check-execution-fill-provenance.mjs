/** Memory-only PostgreSQL helper. Never reads env files or calls any provider. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";

export async function checkExecutionFillProvenance(db) {
  const signature="public.persist_execution_fill_page(jsonb)";
  const coverageSignature="public.execution_fill_coverage_v1(uuid,text,text,timestamptz,timestamptz)";
  for(const role of ["anon","authenticated"]){
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,coverageSignature])).rows[0].allowed,false);
    for(const table of ["execution_fills","execution_fill_sync_states","execution_fill_sync_pages"])
      assert.equal((await db.query("select has_table_privilege($1,$2,'select') allowed",[role,`public.${table}`])).rows[0].allowed,false);
  }
  await db.exec("set role anon");
  await assert.rejects(db.query("select public.persist_execution_fill_page('{}')"),error=>error.code==="42501");
  await assert.rejects(db.query("select public.execution_fill_coverage_v1(null,null,null,null,null)"),error=>error.code==="42501");
  await db.exec("reset role; set role service_role");
  try{
    const a=randomUUID(),b=randomUUID(),asset=randomUUID(),intent=randomUUID(),safety=randomUUID(),order=randomUUID();
    const now=new Date(),start=new Date(now.getTime()-86400000),end=new Date(now.getTime()-1000),trade=new Date(now.getTime()-3600000),retention=new Date(now.getTime()-60*86400000);
    await db.query("insert into public.execution_accounts(id,account_key,provider,provider_environment,status) values($1,$2,'okx-demo','DEMO','ACTIVE'),($3,$4,'okx-demo','DEMO','ACTIVE')",[a,`fill-${a}`,b,`fill-${b}`]);
    await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Fill fixture')",[asset,`fill-${asset}`]);
    await db.query(`insert into public.execution_intents(id,intent_key,contract_version,source_type,source_id,asset_id,instrument_id,side,order_type,quote_amount_sek,quantity,max_slippage_bps,information_cutoff_at,available_at,expires_at,evidence_refs,payload_hash)
      values($1,$2,'execution-contract-v1','fixture','fixture',$3,'BTC-USDT','BUY','MARKET',100,1,25,$4,$4,$5,'[]','fixture')`,[intent,`fill-${intent}`,asset,start,now]);
    await db.query(`insert into public.execution_safety_evaluations(id,evaluation_key,intent_id,policy_version,decision,requirements,context,limits,result_hash,information_cutoff_at,available_at)
      values($1,$2,$3,'fixture','PASSED','[]','{}','{}','fixture',$4,$4)`,[safety,`fill-${safety}`,intent,start]);
    await db.query("insert into public.execution_orders(id,intent_id,safety_evaluation_id,provider,provider_environment,client_order_id,provider_order_id,current_state) values($1,$2,$3,'okx-demo','DEMO',$4,'777','CANCELLED')",[order,intent,safety,`fill-${order}`]);
    const legacy=randomUUID();
    await db.query("insert into public.execution_fills(id,fill_key,order_id,provider_fill_id,quantity,price,occurred_at,available_at,payload_hash) values($1,$2,$3,'legacy',1,100,$4,$4,'legacy')",[legacy,`fill-${legacy}`,order,start]);
    const legacyRow=(await db.query("select provenance_status,account_id from public.execution_fills where id=$1",[legacy])).rows[0];
    assert.deepEqual(legacyRow,{provenance_status:"LEGACY_UNVERIFIED",account_id:null});
    const fill=(id="100",bill="1000",overrides={})=>({providerFillId:id,providerBillId:bill,providerOrderId:"777",clientOrderId:null,instrumentId:"BTC-USDT",side:"BUY",quantity:"0.5",price:"100",feeAmount:"0.001",providerFeeAmount:"-0.001",feeCurrency:"BTC",baseCurrency:"BTC",quoteCurrency:"USDT",quoteCurrencySource:"OKX_TRADE_QUOTE_CCY",occurredAt:trade.toISOString(),providerRecordedAt:new Date(trade.getTime()+1).toISOString(),...overrides});
    let windowCounter=0;
    const page=(overrides={})=>{const requestedStart=new Date(start.getTime()+windowCounter++).toISOString();const scope={account_id:a,provider:"okx-demo",provider_environment:"DEMO",requested_start_at:requestedStart,requested_end_at:end.toISOString()};return{...scope,sync_key:createHash("sha256").update(JSON.stringify(scope)).digest("hex"),request_cursor:null,page_size:2,status:"COMPLETE_WINDOW",effective_start_at:requestedStart,effective_end_at:end.toISOString(),retention_start_at:retention.toISOString(),retention_limited:false,source:"OKX_FILLS_HISTORY_3_MONTHS",time_basis:"PROVIDER_RECORDED_AT",observed_at:now.toISOString(),next_cursor:null,exhausted:true,fills:[fill()],...overrides}};
    const persist=async p=>(await db.query("select public.persist_execution_fill_page($1::jsonb) result",[JSON.stringify(p)])).rows[0].result;
    const first=page(),r=await persist(first);assert.equal(r.inserted,1);assert.equal(r.status,"COMPLETE_WINDOW");
    let stored=(await db.query("select * from public.execution_fills where account_id=$1",[a])).rows[0];
    assert.equal(stored.order_id,null,"a matching provider order without explicit account is not verified local lineage");assert.equal(stored.order_mapping_status,"EXTERNAL_ORDER");assert.equal(stored.provenance_status,"VERIFIED_PROVIDER");assert.equal(Number(stored.fee_amount),0.001);assert.equal(Number(stored.provider_fee_amount),-0.001);
    assert.equal((await persist({...first,observed_at:new Date(now.getTime()+1).toISOString()})).inserted,0,"same page retry is idempotent");
    const previousZone=(await db.query("show timezone")).rows[0].TimeZone;
    await db.exec("set timezone='Pacific/Honolulu'");
    assert.equal((await persist(first)).inserted,0,"immutable hashes are independent of session timezone");
    await db.query("select set_config('TimeZone',$1,false)",[previousZone]);
    await assert.rejects(persist({...first,fills:[fill("100","1000",{price:"101"})]}),/FILL_PAGE_PAYLOAD_CONFLICT/);
    const conflict=page({fills:[fill("100","1000",{price:"101"})]});
    await assert.rejects(persist(conflict),/FILL_PAYLOAD_CONFLICT/);
    assert.equal((await db.query("select count(*)::int count from public.execution_fill_sync_states where sync_key=$1",[conflict.sync_key])).rows[0].count,0,"fill conflict rolls back checkpoint creation");
    await db.query("update public.execution_orders set account_id=$1 where id=$2",[a,order]);
    assert.equal((await persist(page())).inserted,0,"retry after local account mapping remains immutable");
    stored=(await db.query("select order_id from public.execution_fills where id=$1",[stored.id])).rows[0];assert.equal(stored.order_id,null);
    const mapped=page({fills:[fill("101","999")]});assert.equal((await persist(mapped)).inserted,1);
    assert.equal((await db.query("select order_id from public.execution_fills where account_id=$1 and provider_fill_id='101'",[a])).rows[0].order_id,order);
    const other=page({account_id:b,fills:[fill()]});other.sync_key=createHash("sha256").update(randomUUID()).digest("hex");assert.equal((await persist(other)).inserted,1,"same trade in another account has separate identity");
    assert.equal((await persist(page({fills:[fill("100","998",{instrumentId:"ETH-USDT",baseCurrency:"ETH"})]}))).inserted,1,"trade ID uniqueness is instrument scoped");
    const partial=page({status:"PARTIAL",fills:[fill("200","900"),fill("201","899")],next_cursor:"899",exhausted:false});const partialResult=await persist(partial);assert.equal(partialResult.status,"PARTIAL");
    const failedSecond={...partial,request_cursor:"899",status:"COMPLETE_WINDOW",next_cursor:null,exhausted:true,page_size:3,fills:[fill("202","898"),fill("200","897",{price:"999"})]};
    await assert.rejects(persist(failedSecond),/FILL_PAYLOAD_CONFLICT/);
    assert.equal((await db.query("select count(*)::int count from public.execution_fills where account_id=$1 and provider_fill_id='202'",[a])).rows[0].count,0,"whole conflicting page rolls back");
    assert.equal((await db.query("select cursor_after_bill_id from public.execution_fill_sync_states where id=$1",[partialResult.checkpoint_id])).rows[0].cursor_after_bill_id,"899");
    const last={...partial,request_cursor:"899",status:"COMPLETE_WINDOW",next_cursor:null,exhausted:true,fills:[fill("202","898")]};assert.equal((await persist(last)).status,"COMPLETE_WINDOW");
    await assert.rejects(persist({...partial,fills:[fill("203","901"),fill("204","900")]}),/FILL_PAGE_PAYLOAD_CONFLICT/);
    for(const bad of [{feeAmount:null},{providerFeeAmount:"0.1"},{quantity:"NaN"},{price:"0"},{quoteCurrency:null},{quoteCurrencySource:"ASSUMED"},{providerRecordedAt:start.toISOString()},{side:null}]){
      const p=page({fills:[fill(String(300+windowCounter),String(800-windowCounter),bad)]});
      await assert.rejects(persist(p),undefined,`reject malformed fact ${JSON.stringify(bad)}`);
    }
    await assert.rejects(persist(page({provider:"different"})),/FILL_ACCOUNT_SCOPE_MISMATCH/);
    await assert.rejects(persist(page({status:"PARTIAL",exhausted:false,next_cursor:"500",fills:[]})),/FILL_CURSOR_MISSING/);
    await assert.rejects(persist(page({status:"COMPLETE_WINDOW",exhausted:false,next_cursor:"1000",page_size:1})),/FILL_COVERAGE_INVALID/);
    const limited=page({status:"RETENTION_GAP",retention_limited:true,effective_start_at:new Date(start.getTime()+3600000).toISOString(),fills:[]});assert.equal((await persist(limited)).status,"RETENTION_GAP");
    const expired=page({status:"RETENTION_GAP",retention_limited:true,effective_start_at:now.toISOString(),exhausted:false,fills:[]});assert.equal((await persist(expired)).exhausted,false);
    const unavailable=page({status:"UNSUPPORTED",fills:[]});assert.equal((await persist(unavailable)).status,"UNSUPPORTED");
    const unavailableRetry={...unavailable,status:"FAILED"};assert.equal((await persist(unavailableRetry)).status,"FAILED");
    assert.equal((await db.query("select page_count from public.execution_fill_sync_states where sync_key=$1",[unavailable.sync_key])).rows[0].page_count,0);
    await assert.rejects(db.query("update public.execution_fills set price=101 where id=$1",[legacy]),/immutable/);
    await assert.rejects(db.query("delete from public.execution_fill_sync_pages where sync_state_id=$1",[r.checkpoint_id]),/immutable/);
    const c=randomUUID(),seriesStart=new Date(now.getTime()-3*86400000);
    await db.query("insert into public.execution_accounts(id,account_key,provider,provider_environment,status) values($1,$2,'okx-demo','DEMO','ACTIVE')",[c,`fill-coverage-${c}`]);
    await db.query(`insert into public.execution_fill_sync_states(sync_key,account_id,provider,provider_environment,requested_start_at,requested_end_at,effective_start_at,effective_end_at,retention_start_at,retention_limited,exhausted,status,source,time_basis,observed_at)
      select $1||':'||n,$2,'okx-demo','DEMO',$3::timestamptz+(n-1)*interval '1 minute',$3::timestamptz+n*interval '1 minute',
      $3::timestamptz+(n-1)*interval '1 minute',$3::timestamptz+n*interval '1 minute',$3::timestamptz-interval '1 day',false,true,'COMPLETE_WINDOW','OKX_FILLS_HISTORY_3_MONTHS','PROVIDER_RECORDED_AT',$3::timestamptz+n*interval '1 minute'+interval '1 millisecond'
      from generate_series(1,1005)n`,[c,c,seriesStart]);
    const coverage=async(account=c,cutoff=now,provider="okx-demo")=>(await db.query("select public.execution_fill_coverage_v1($1,$2,'DEMO',$3,$4) result",[account,provider,seriesStart,cutoff])).rows[0].result;
    const full=await coverage();assert.equal(full.checkpointCount,1005);assert.equal(Date.parse(full.through),seriesStart.getTime()+1005*60000);assert.match(full.checkpointHash,/^[0-9a-f]{64}$/);assert.ok(JSON.stringify(full).length<200,"response size is bounded independently of history length");
    const pit=await coverage(c,new Date(seriesStart.getTime()+500*60000+1));assert.equal(pit.checkpointCount,500);assert.equal(Date.parse(pit.through),seriesStart.getTime()+500*60000);
    const laterStart=new Date(seriesStart.getTime()+1006*60000).toISOString(),laterEnd=new Date(seriesStart.getTime()+1007*60000).toISOString();
    const gapPage=page({account_id:c,requested_start_at:laterStart,requested_end_at:laterEnd,effective_start_at:laterStart,effective_end_at:laterEnd,fills:[]});gapPage.sync_key=createHash("sha256").update(randomUUID()).digest("hex");await persist(gapPage);
    assert.deepEqual(await coverage(),full,"disconnected later window cannot hide a gap");
    assert.deepEqual(await coverage(b),{through:null,checkpointCount:0,checkpointHash:null},"other account cannot inherit coverage");
    assert.deepEqual(await coverage(c,now,"wrong-provider"),{through:null,checkpointCount:0,checkpointHash:null});
    const bridgeStart=new Date(seriesStart.getTime()+1005*60000).toISOString();
    await db.query(`insert into public.execution_fill_sync_states(sync_key,account_id,provider,provider_environment,requested_start_at,requested_end_at,effective_start_at,effective_end_at,retention_start_at,exhausted,status,source,time_basis,observed_at)
      values($1,$2,'okx-demo','DEMO',$3,$4,$3,$4,$5,true,'COMPLETE_WINDOW',null,'PROVIDER_RECORDED_AT',$6)`,[randomUUID(),c,bridgeStart,laterStart,retention,now]);
    assert.deepEqual(await coverage(),full,"malformed source cannot bridge coverage");
    console.log("Fill provenance RPC: private roles, account/instrument identity, fee signs, immutable lineage, retries/hash conflicts/atomic rollback, cursors/retention and bounded >1000-window coverage with gaps/PIT passed.");
  }finally{await db.exec("reset role")}
}
