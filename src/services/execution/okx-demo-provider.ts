import { createHmac } from "node:crypto";
import type { ExecutionOrderRequest,ExecutionProvider,ProviderOrder,ProviderExecutionFill,ProviderFillPage,ProviderFillPageRequest } from "./provider";

type Fetcher=typeof fetch;type OkxEnvelope<T>={code:string;msg:string;data:T[]};
interface OkxOrder{ordId:string;clOrdId:string;state:string;accFillSz?:string;avgPx?:string;sCode?:string;sMsg?:string}
interface OkxConfig{perm:string;acctLv:string}
interface OkxBalance{totalEq?:string;details?:Array<{ccy:string;cashBal?:string;availBal?:string;eqUsd?:string}>}
interface OkxPosition{instId:string;pos?:string;avgPx?:string;upl?:string}
export interface OkxDemoCredentials{apiKey:string;secretKey:string;passphrase:string;baseUrl?:string}

export class OkxDemoExecutionProvider implements ExecutionProvider{
  readonly name="okx-demo";readonly mode="DEMO" as const;private baseUrl:string;
  constructor(private credentials:OkxDemoCredentials,private fetcher:Fetcher=fetch){this.baseUrl=validateBaseUrl(credentials.baseUrl??"https://eea.okx.com")}
  async health(){try{const config=(await this.request<OkxConfig>("GET","/api/v5/account/config"))[0];if(!config)return{status:"FAILED"as const,credentialsValid:false,tradePermission:false,withdrawPermission:null};const permissions=config.perm.split(",").map(x=>x.trim().toLowerCase()),tradePermission=permissions.includes("trade"),withdrawPermission=permissions.includes("withdraw"),spotMode=config.acctLv==="1";return{status:tradePermission&&!withdrawPermission&&spotMode?"HEALTHY"as const:"DEGRADED"as const,credentialsValid:true,tradePermission,withdrawPermission}}catch{return{status:"FAILED"as const,credentialsValid:false,tradePermission:false,withdrawPermission:null}}}
  async getAccountState(){const observedAt=new Date().toISOString(),balance=(await this.request<OkxBalance>("GET","/api/v5/account/balance"))[0],positions=await this.request<OkxPosition>("GET","/api/v5/account/positions");if(!balance)return{balances:[],positions:[],totalEquityUsd:null,availableQuoteUsd:null,status:"UNKNOWN"as const,unknownReasons:["OKX_BALANCE_MISSING"],observedAt,sourceReference:"/api/v5/account/balance"};const balances=(balance.details??[]).map(x=>({currency:x.ccy,total:Number(x.cashBal??0),available:x.availBal===undefined?null:Number(x.availBal)})),availableQuote=balances.filter(x=>["USD","USDT","USDC"].includes(x.currency)).reduce((sum,x)=>sum+(x.available??0),0);return{balances,positions:positions.map(x=>({instrumentId:x.instId,quantity:Number(x.pos??0),averagePrice:x.avgPx?Number(x.avgPx):null,unrealizedPnl:x.upl?Number(x.upl):null})),totalEquityUsd:balance.totalEq?Number(balance.totalEq):null,availableQuoteUsd:availableQuote,status:balance.totalEq?"KNOWN"as const:"PARTIAL"as const,unknownReasons:balance.totalEq?[]:["TOTAL_EQUITY_USD_MISSING"],observedAt,sourceReference:"/api/v5/account/balance"}}
  async placeOrder(order:ExecutionOrderRequest){if(order.quantity===null||order.quantity<=0)throw new Error("OKX demo requires an explicit positive base quantity");const body:Record<string,string>={instId:order.instrumentId,tdMode:"cash",clOrdId:order.clientOrderId,side:order.side.toLowerCase(),ordType:order.orderType.toLowerCase(),sz:String(order.quantity),tgtCcy:"base_ccy"};if(order.orderType==="LIMIT"){if(order.limitPrice===null||order.limitPrice<=0)throw new Error("Limit price required");body.px=String(order.limitPrice)}const response=(await this.request<OkxOrder>("POST","/api/v5/trade/order",body))[0];if(!response||response.sCode&&response.sCode!=="0")throw new Error(response?.sMsg||"OKX demo rejected order");return mapOrder(response,order.clientOrderId)}
  async getOrder(instrumentId:string,clientOrderId:string,providerOrderId:string|null){const query=`?instId=${encodeURIComponent(instrumentId)}&${providerOrderId?`ordId=${encodeURIComponent(providerOrderId)}`:`clOrdId=${encodeURIComponent(clientOrderId)}`}`,order=(await this.request<OkxOrder>("GET",`/api/v5/trade/order${query}`))[0];return order?mapOrder(order,clientOrderId):null}
  async getFillsPage(input:ProviderFillPageRequest):Promise<ProviderFillPage>{
    const now=new Date(),start=validDate(input.windowStart),end=validDate(input.windowEnd),limit=input.limit??100;
    if(start>end||end>now||!Number.isInteger(limit)||limit<1||limit>100)throw new Error("OKX_FILL_WINDOW_INVALID");
    if(input.afterBillId!==undefined&&input.afterBillId!==null)positiveId(input.afterBillId);
    if(input.instrumentId!==undefined&&!/^[A-Z0-9]{1,20}-[A-Z0-9]{1,20}$/.test(input.instrumentId))throw new Error("OKX_FILL_INSTRUMENT_INVALID");
    if(input.providerOrderId!==undefined)positiveId(input.providerOrderId);
    const retention=okxFillRetentionStart(now),effectiveStart=new Date(Math.max(start.getTime(),retention.getTime()));
    // An entirely expired window is a retention gap, never an empty verified history.
    if(end<retention)return{status:"SUPPORTED",fills:[],nextCursor:null,exhausted:false,observedAt:now.toISOString(),window:{requestedStart:start.toISOString(),requestedEnd:end.toISOString(),effectiveStart:retention.toISOString(),effectiveEnd:end.toISOString(),retentionStart:retention.toISOString(),retentionLimited:true,source:"OKX_FILLS_HISTORY_3_MONTHS",timeBasis:"PROVIDER_RECORDED_AT"}};
    const query=new URLSearchParams({instType:"SPOT",begin:String(effectiveStart.getTime()),end:String(end.getTime()),limit:String(limit)});
    if(input.afterBillId)query.set("after",input.afterBillId);
    if(input.instrumentId)query.set("instId",input.instrumentId);
    if(input.providerOrderId)query.set("ordId",input.providerOrderId);
    const rows=await this.request<unknown>("GET",`/api/v5/trade/fills-history?${query}`,undefined,10_000),observedAt=new Date().toISOString();
    if(!Array.isArray(rows)||rows.length>limit)throw new Error("OKX_FILL_PAGE_INVALID");
    const fills=rows.map(row=>mapOkxExecutionFill(row,observedAt));
    let previous=input.afterBillId?BigInt(input.afterBillId):null;
    const identities=new Set<string>();
    for(const fill of fills){
      const bill=BigInt(fill.providerBillId),recorded=Date.parse(fill.providerRecordedAt),identity=`${fill.instrumentId}:${fill.providerFillId}`;
      if((previous!==null&&bill>=previous)||identities.has(identity)||recorded<effectiveStart.getTime()||recorded>end.getTime()||(input.instrumentId&&fill.instrumentId!==input.instrumentId)||(input.providerOrderId&&fill.providerOrderId!==input.providerOrderId))throw new Error("OKX_FILL_PAGE_SCOPE_OR_CURSOR_INVALID");
      previous=bill;identities.add(identity);
    }
    const exhausted=fills.length<limit;
    return{status:"SUPPORTED",fills,nextCursor:exhausted?null:fills[fills.length-1].providerBillId,exhausted,observedAt,window:{requestedStart:start.toISOString(),requestedEnd:end.toISOString(),effectiveStart:effectiveStart.toISOString(),effectiveEnd:end.toISOString(),retentionStart:retention.toISOString(),retentionLimited:start<retention,source:"OKX_FILLS_HISTORY_3_MONTHS",timeBasis:"PROVIDER_RECORDED_AT"}};
  }
  async cancelOrder(instrumentId:string,clientOrderId:string,providerOrderId:string|null):Promise<ProviderOrder>{const body:Record<string,string>={instId:instrumentId};if(providerOrderId)body.ordId=providerOrderId;else body.clOrdId=clientOrderId;const order=(await this.request<OkxOrder>("POST","/api/v5/trade/cancel-order",body))[0];if(!order||order.sCode&&order.sCode!=="0")throw new Error(order?.sMsg||"OKX demo cancel failed");return{...mapOrder(order,clientOrderId),state:"CANCELLED"}}
  private async request<T>(method:"GET"|"POST",path:string,body?:Record<string,string>,timeoutMs?:number){const timestamp=new Date().toISOString(),bodyText=body?JSON.stringify(body):"",signature=createHmac("sha256",this.credentials.secretKey).update(`${timestamp}${method}${path}${bodyText}`).digest("base64"),response=await this.fetcher(`${this.baseUrl}${path}`,{method,headers:{"Content-Type":"application/json","OK-ACCESS-KEY":this.credentials.apiKey,"OK-ACCESS-SIGN":signature,"OK-ACCESS-TIMESTAMP":timestamp,"OK-ACCESS-PASSPHRASE":this.credentials.passphrase,"x-simulated-trading":"1","expTime":String(Date.now()+5000)},body:bodyText||undefined,signal:timeoutMs?AbortSignal.timeout(timeoutMs):undefined});if(response.status===429)throw new Error("OKX_DEMO_RATE_LIMITED");const json=await response.json() as OkxEnvelope<T>;if(!response.ok||json.code!=="0")throw new Error(`OKX_DEMO_ERROR:${json.code}:${json.msg}`);return json.data}
}
function validateBaseUrl(value:string){const url=new URL(value),allowed=new Set(["https://eea.okx.com","https://openapi.okx.com","https://us.okx.com"]);if(url.pathname!=="/"||url.search||url.hash||!allowed.has(url.origin))throw new Error("Unapproved OKX demo base URL");return url.origin}
function mapOrder(order:OkxOrder,clientOrderId:string):ProviderOrder{const state=order.state==="filled"?"FILLED":order.state==="partially_filled"?"PARTIALLY_FILLED":order.state==="canceled"?"CANCELLED":order.state==="mmp_canceled"?"CANCELLED":order.state==="live"?"ACKNOWLEDGED":"ACKNOWLEDGED";return{providerOrderId:order.ordId,clientOrderId:order.clOrdId||clientOrderId,state,filledQuantity:Number(order.accFillSz??0),averagePrice:order.avgPx?Number(order.avgPx):null,observedAt:new Date().toISOString(),rawReference:order.ordId}}

function validDate(value:string){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error("OKX_FILL_TIMESTAMP_INVALID");return date}
function positiveId(value:unknown):string{if(typeof value!=="string"||!/^[1-9][0-9]{0,39}$/.test(value))throw new Error("OKX_FILL_ID_INVALID");return value}
function currency(value:unknown):string{if(typeof value!=="string"||!/^[A-Z0-9]{1,20}$/.test(value))throw new Error("OKX_FILL_CURRENCY_INVALID");return value}
function decimal(value:unknown,positive=false):string{
  if(typeof value!=="string"||!/^[-+]?[0-9]{1,30}(\.[0-9]{1,36})?$/.test(value)||!Number.isFinite(Number(value))||(positive&&Number(value)<=0))throw new Error("OKX_FILL_DECIMAL_INVALID");
  const negative=value.startsWith("-"),[whole,fraction=""]=value.replace(/^[-+]/,"").split("."),integer=whole.replace(/^0+(?=\d)/,""),tail=fraction.replace(/0+$/,"");
  const magnitude=integer+(tail?`.${tail}`:"");return negative&&magnitude!=="0"?`-${magnitude}`:magnitude;
}
/** Calendar months, not an invented 90-day guarantee. Clamps month-end dates. */
export function okxFillRetentionStart(now:Date){const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-3);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date}
export function mapOkxExecutionFill(value:unknown,observedAt:string):ProviderExecutionFill{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("OKX_FILL_INVALID");
  const row=value as Record<string,unknown>,instrument=typeof row.instId==="string"?row.instId.match(/^([A-Z0-9]{1,20})-([A-Z0-9]{1,20})$/):null;
  if(row.instType!=="SPOT"||!instrument||(row.side!=="buy"&&row.side!=="sell")||typeof row.clOrdId!=="string"||!/^[a-zA-Z0-9]{0,32}$/.test(row.clOrdId))throw new Error("OKX_FILL_SCOPE_INVALID");
  const timestamp=(value:unknown)=>{const text=positiveId(value),ms=Number(text);if(!Number.isSafeInteger(ms)||ms>Date.parse(observedAt)||ms<=0)throw new Error("OKX_FILL_TIMESTAMP_INVALID");return validDate(new Date(ms).toISOString()).toISOString()};
  const fee=decimal(row.fee),feeAmount=fee==="0"?"0":fee.startsWith("-")?fee.slice(1):`-${fee}`;
  return{providerFillId:positiveId(row.tradeId),providerBillId:positiveId(row.billId),providerOrderId:positiveId(row.ordId),clientOrderId:row.clOrdId||null,instrumentId:instrument[0],side:row.side==="buy"?"BUY":"SELL",quantity:decimal(row.fillSz,true),price:decimal(row.fillPx,true),feeAmount,providerFeeAmount:fee,feeCurrency:currency(row.feeCcy),baseCurrency:instrument[1],quoteCurrency:currency(row.tradeQuoteCcy),quoteCurrencySource:"OKX_TRADE_QUOTE_CCY",occurredAt:timestamp(row.fillTime),providerRecordedAt:timestamp(row.ts)};
}
