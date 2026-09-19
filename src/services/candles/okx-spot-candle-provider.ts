import { timeframeSeconds, type CandleRequest, type HistoricalCandleProvider, type ProviderCandle } from "./provider";
/** Public market data only; no API keys or order endpoints. */
export class OkxSpotCandleProvider implements HistoricalCandleProvider {
  readonly name="okx-spot-candles";
  constructor(private fetcher:typeof fetch=fetch){}
  async getCandles(request:CandleRequest){
    if(request.instrumentKind!=="CRYPTO_SPOT" || !/^[A-Z0-9]+-EUR$/.test(request.providerSymbol) || !["1m","5m","15m","1h"].includes(request.timeframe))throw new Error("OKX_CANDLE_SCOPE_INVALID");
    const start=Date.parse(request.startsAt),end=Date.parse(request.endsAt),cursor=request.cursor?Date.parse(request.cursor):end;
    if(![start,end,cursor].every(Number.isFinite)||start>=end||cursor>end)throw new Error("OKX_CANDLE_WINDOW_INVALID");
    const limit=Math.min(100,request.limit??100),bar=request.timeframe.replace("h","H");
    const response=await this.fetcher(`https://eea.okx.com/api/v5/market/history-candles?instId=${request.providerSymbol}&bar=${bar}&after=${cursor}&limit=${limit}`,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`OKX_CANDLES_HTTP_${response.status}`);
    const body=await response.json();if(body.code!=="0"||!Array.isArray(body.data)||body.data.length>limit)throw new Error("OKX_CANDLES_RESPONSE_INVALID");
    const observedAt=new Date().toISOString(),candles:ProviderCandle[]=[],seen=new Set<number>();let oldest=cursor;
    for(const row of body.data){
      if(!Array.isArray(row)||row.length<9)throw new Error("OKX_CANDLE_INVALID");
      const ts=Number(row[0]),closed=ts+timeframeSeconds(request.timeframe)*1000;
      if(!Number.isSafeInteger(ts)||seen.has(ts)||ts>=oldest)throw new Error("OKX_CANDLE_PAGINATION_INVALID");
      seen.add(ts);oldest=ts;
      if(row[8]!=="1"||ts<start||closed>end||closed>Date.parse(observedAt))continue;
      const [open,high,low,close,volume]=row.slice(1,6).map(Number);
      if(![open,high,low,close].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(volume)||volume<0||high<Math.max(open,low,close)||low>Math.min(open,close))throw new Error("OKX_CANDLE_PRICE_INVALID");
      candles.push({id:`okx:${request.providerSymbol}:${request.timeframe}:${ts}`,assetId:request.assetId,timeframe:request.timeframe,provider:this.name,
        openedAt:new Date(ts).toISOString(),closedAt:new Date(closed).toISOString(),observedAt,availableAt:observedAt,open,high,low,close,volume,dataQuality:95,
        rawPayload:{instrumentId:request.providerSymbol,quoteCurrency:"EUR",row}});
    }
    return {candles,nextCursor:body.data.length===limit&&oldest>start?new Date(oldest).toISOString():null,rateLimit:{remaining:null,resetAt:null}};
  }
}
