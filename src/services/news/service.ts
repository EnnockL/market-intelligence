import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventEnvelope } from "@/domain/events";
import type { NewsProvider } from "./provider";
import { ForecastCatalystService } from "@/services/forecast-catalyst/service";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

export class NewsIngestionService {
  constructor(private db:SupabaseClient,private provider:NewsProvider){}
  async run(symbols:string[],now=new Date().toISOString(),limit=50){
    const from=new Date(Date.parse(now)-24*60*60*1000).toISOString();const result=await this.provider.fetchNews({symbols,from,to:now,limit});let inserted=0,catalysts=0;
    const transport=new PostgresOutboxTransport(this.db),watch=new ForecastCatalystService(this.db);
    for(const item of result.observations){
      const{data:asset,error:assetError}=await this.db.from("assets").select("id").eq("kind","stock").eq("symbol",item.symbol).maybeSingle();if(assetError)throw assetError;if(!asset)continue;
      const saved=await this.db.from("news_observations").insert({observation_key:item.observationKey,observation_version:"news-observation-v1",asset_id:asset.id,provider:item.provider,provider_article_id:item.providerArticleId,headline:item.headline,summary:item.summary,url:item.url,source_name:item.sourceName,source_classification:item.sourceClassification,occurred_at:item.occurredAt,observed_at:item.observedAt,available_at:item.availableAt,data_quality:item.dataQuality,raw_payload:item.rawPayload}).select("id").maybeSingle();
      if(saved.error?.code==="23505")continue;if(saved.error)throw saved.error;inserted++;
      const id=saved.data!.id as string,event=createEventEnvelope({eventType:"news.observed",entityType:"news_observation",entityId:id,assetId:asset.id,occurredAt:item.occurredAt,observedAt:item.observedAt,availableAt:item.availableAt,provider:item.provider,sourceReference:item.url,dataQuality:item.dataQuality,confidence:null,payload:{headline:item.headline,sourceName:item.sourceName,sourceClassification:item.sourceClassification,observationVersion:"news-observation-v1"},correlationId:asset.id,causationId:null});
      await transport.publish(event);
      const catalyst=await watch.ingest({assetId:asset.id,catalystType:"NEWS_OBSERVATION",materiality:"UNKNOWN",novelty:"UNKNOWN",sourceClassification:item.sourceClassification,sourceConfidence:null,watchWindow:"SHORT",occurredAt:item.occurredAt,observedAt:item.observedAt,availableAt:item.availableAt,sourceReference:item.url,evidenceRefs:[event.eventId],details:{newsObservationId:id,headline:item.headline,producerAssessment:"NONE"}});if(!catalyst.reused)catalysts++;
    }
    return{fetched:result.observations.length,inserted,catalysts,remaining:result.remaining,resetAt:result.resetAt};
  }
}
