import { z } from "zod";
import { classifyNewsSource, newsObservationKey, type NewsObservation } from "@/domain/news";
import { NewsProviderError, type NewsProvider, type NewsProviderResult, type NewsRequest } from "./provider";
import { fetchWithRetry, type FetchRetryOptions } from "@/services/providers/fetch-with-retry";

const articleSchema=z.object({id:z.union([z.number(),z.string()]),category:z.string().optional(),datetime:z.number().positive(),headline:z.string().min(1),image:z.string().optional(),related:z.string().optional(),source:z.string().min(1),summary:z.string().optional(),url:z.string().url()});
export class FinnhubNewsProvider implements NewsProvider {
  readonly name="finnhub";
  constructor(private apiKey:string,private fetcher:typeof fetch=fetch,private timeoutMs=12_000,private retryOptions:FetchRetryOptions={}){}
  async fetchNews(request:NewsRequest):Promise<NewsProviderResult>{
    const observations:NewsObservation[]=[];let remaining:number|null=null,resetAt:string|null=null;
    for(const symbol of [...new Set(request.symbols)].sort()){
      let response:Response;
      try{response=await fetchWithRetry(()=>this.fetcher(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${request.from.slice(0,10)}&to=${request.to.slice(0,10)}&token=${encodeURIComponent(this.apiKey)}`,{signal:AbortSignal.timeout(this.timeoutMs)}),this.retryOptions)}catch(error){throw new NewsProviderError(`Finnhub news network failure: ${error instanceof Error?error.message:"unknown"}`,this.name,"unavailable",true)}
      remaining=numberHeader(response.headers.get("x-ratelimit-remaining"));const reset=numberHeader(response.headers.get("x-ratelimit-reset"));resetAt=reset===null?null:new Date(reset*1000).toISOString();
      if(response.status===429)throw new NewsProviderError("Finnhub news rate limit reached",this.name,"rate_limited",true,429,retryMs(response.headers.get("retry-after")));
      if(response.status===401||response.status===403)throw new NewsProviderError("Finnhub API key was rejected",this.name,"unauthorized",false,response.status);
      if(!response.ok)throw new NewsProviderError(`Finnhub news returned HTTP ${response.status}`,this.name,"unavailable",response.status>=500,response.status);
      const parsed=z.array(articleSchema).safeParse(await response.json());if(!parsed.success)throw new NewsProviderError("Finnhub returned invalid news",this.name,"invalid_response",false,response.status);
      const receivedAt=new Date().toISOString();for(const article of parsed.data.slice(0,request.limit)){
        // Provider clocks can be slightly ahead of ours. Keep the original in
        // rawPayload, but never persist future-known point-in-time data.
        const providerOccurredAt=new Date(article.datetime*1000).toISOString(),occurredAt=providerOccurredAt>receivedAt?receivedAt:providerOccurredAt,providerArticleId=String(article.id),sourceClassification=classifyNewsSource(article.url);
        observations.push({observationKey:newsObservationKey({provider:this.name,providerArticleId,symbol}),provider:this.name,providerArticleId,symbol,headline:article.headline,summary:article.summary?.trim()||null,url:article.url,sourceName:article.source,sourceClassification,occurredAt,observedAt:receivedAt,availableAt:receivedAt,dataQuality:sourceClassification==="UNKNOWN"?50:80,rawPayload:article});
      }
    }
    return{observations:observations.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.observationKey.localeCompare(b.observationKey)),remaining,resetAt};
  }
}
function numberHeader(value:string|null){const number=value===null?NaN:Number(value);return Number.isFinite(number)?number:null}function retryMs(value:string|null){const number=numberHeader(value);return number===null?null:number*1000}
