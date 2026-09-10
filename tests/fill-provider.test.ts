import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OkxDemoExecutionProvider, mapOkxExecutionFill, okxFillRetentionStart } from "@/services/execution/okx-demo-provider";
import { ShadowExecutionProvider } from "@/services/execution/shadow-provider";

const now="2026-09-07T12:00:00.000Z",request={windowStart:"2026-09-01T00:00:00.000Z",windowEnd:"2026-09-07T11:59:59.000Z"};
const raw=(overrides:Record<string,unknown>={})=>({instType:"SPOT",instId:"BTC-USDT",side:"buy",tradeId:"744876980",billId:"680800019754098688",ordId:"680800019749904384",clOrdId:"client1",fillSz:"0.0019283400",fillPx:"51858.00",fee:"-0.000001928340",feeCcy:"BTC",fillTime:String(Date.parse("2026-09-06T10:00:00Z")),ts:String(Date.parse("2026-09-06T10:00:00.001Z")),tradeQuoteCcy:"USDT",...overrides});
function provider(data:unknown,status=200){const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:"0",msg:"",data}),{status}));return{fetcher,provider:new OkxDemoExecutionProvider({apiKey:"fixture",secretKey:"fixture",passphrase:"fixture"},fetcher)}}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(now))});afterEach(()=>vi.useRealTimers());

describe("OKX demo individual fill evidence (fixture fetch only)",()=>{
  it("preserves exact fill identity, quantity, separate timestamps and base-currency fee",()=>{
    expect(mapOkxExecutionFill(raw(),now)).toMatchObject({providerFillId:"744876980",providerBillId:"680800019754098688",quantity:"0.00192834",price:"51858",feeAmount:"0.00000192834",providerFeeAmount:"-0.00000192834",feeCurrency:"BTC",baseCurrency:"BTC",quoteCurrency:"USDT",quoteCurrencySource:"OKX_TRADE_QUOTE_CCY",occurredAt:"2026-09-06T10:00:00.000Z",providerRecordedAt:"2026-09-06T10:00:00.001Z"});
  });
  it.each([['0','0'],['0.25','-0.25'],['-0.25','0.25'],['-0.000','0']])("normalizes signed provider fee %s to debit %s",(fee,expected)=>expect(mapOkxExecutionFill(raw({fee}),now).feeAmount).toBe(expected));
  it("uses actual tradeQuoteCcy instead of assuming instrument quote/USDT equals USD",()=>expect(mapOkxExecutionFill(raw({instId:"BTC-USD",tradeQuoteCcy:"USDC"}),now).quoteCurrency).toBe("USDC"));
  it.each([{fillSz:""},{fillSz:"0"},{fillSz:"NaN"},{fillPx:"Infinity"},{fillPx:"1e3"},{fee:""},{feeCcy:""},{tradeQuoteCcy:""},{tradeId:"0"},{tradeId:"-1"},{billId:"9007199254740993.0"},{instType:"SWAP"},{instId:"BTC-USDT-SWAP"},{side:"unknown"},{fillTime:""},{ts:String(Date.parse(now)+1)},{clOrdId:"bad\nclient"}])("rejects missing/malformed fact %j",override=>expect(()=>mapOkxExecutionFill(raw(override),now)).toThrow());
  it("does not invent an individual fill from cumulative order quantity",()=>expect(()=>mapOkxExecutionFill({instId:"BTC-USDT",state:"filled",accFillSz:"1",avgPx:"100"},now)).toThrow());
  it("signs GET history query, keeps demo header and billId precision",async()=>{
    const h=provider([raw()]),page=await h.provider.getFillsPage({...request,limit:1,afterBillId:"680800019754098689"});
    expect(h.fetcher).toHaveBeenCalledOnce();const [url,options]=h.fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toContain("/api/v5/trade/fills-history?instType=SPOT");expect(url).toContain("after=680800019754098689");expect(url).toContain(`begin=${Date.parse(request.windowStart)}`);expect(options.method).toBe("GET");expect(options.headers).toMatchObject({"x-simulated-trading":"1"});
    expect(page).toMatchObject({status:"SUPPORTED",nextCursor:"680800019754098688",exhausted:false});
  });
  it("only exhausts a short page inside explicit retained window",async()=>expect(await provider([]).provider.getFillsPage(request)).toMatchObject({status:"SUPPORTED",exhausted:true,nextCursor:null,window:{retentionLimited:false,timeBasis:"PROVIDER_RECORDED_AT"}}));
  it.each([
    [raw(),raw()],
    [raw(),raw({tradeId:"744876981",billId:"680800019754098689"})],
    [raw({ts:String(Date.parse(request.windowStart)-1)})],
  ].map(rows=>({rows})))("rejects duplicate/nondecreasing/out-of-window page %j",async({rows})=>{await expect(provider(rows).provider.getFillsPage({...request,limit:3})).rejects.toThrow()});
  it("rejects response crossing requested instrument/order scope",async()=>{await expect(provider([raw()]).provider.getFillsPage({...request,instrumentId:"ETH-USDT"})).rejects.toThrow();await expect(provider([raw()]).provider.getFillsPage({...request,providerOrderId:"42"})).rejects.toThrow()});
  it("does not send invalid cursor/window/limit",async()=>{const h=provider([]);for(const invalid of [{afterBillId:"1e20"},{limit:101},{windowEnd:"2026-09-08T00:00:00Z"}])await expect(h.provider.getFillsPage({...request,...invalid})).rejects.toThrow();expect(h.fetcher).not.toHaveBeenCalled()});
  it("exposes partial retention without claiming older completeness",async()=>expect(await provider([]).provider.getFillsPage({...request,windowStart:"2026-01-01T00:00:00Z"})).toMatchObject({status:"SUPPORTED",window:{retentionLimited:true,effectiveStart:"2026-06-07T12:00:00.000Z"}}));
  it("never calls provider or claims exhaustion for an entirely expired window",async()=>{const h=provider([]);expect(await h.provider.getFillsPage({windowStart:"2026-01-01T00:00:00Z",windowEnd:"2026-02-01T00:00:00Z"})).toMatchObject({status:"SUPPORTED",exhausted:false,window:{retentionLimited:true}});expect(h.fetcher).not.toHaveBeenCalled()});
  it("clamps three calendar months at month end",()=>expect(okxFillRetentionStart(new Date("2026-05-31T12:00:00Z")).toISOString()).toBe("2026-02-28T12:00:00.000Z"));
  it("rate limits and malformed envelopes fail, never empty-success",async()=>{await expect(provider([],429).provider.getFillsPage(request)).rejects.toThrow("RATE_LIMITED");await expect(provider({}).provider.getFillsPage(request)).rejects.toThrow("PAGE_INVALID")});
  it("shadow explicitly has no fill source",async()=>expect(await new ShadowExecutionProvider().getFillsPage()).toEqual({status:"UNSUPPORTED",reason:"SHADOW_PROVIDER_HAS_NO_FILL_SOURCE"}));
});
