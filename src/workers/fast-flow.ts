import { hostname } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";
import { processEventBatch } from "@/services/events/transport";
import { FastFlowService } from "@/services/fast-flow/service";

export async function runFastFlow(db:SupabaseClient,repository:IngestionRepository){const runId=await repository.startRun("fast_flow","postgres-outbox");try{const service=new FastFlowService(db);const transport=new PostgresOutboxTransport(db,{name:"fast-flow-v1",eventTypes:["wallet.buy_detected"]});
  const result=await processEventBatch(transport,event=>service.handle(event).then(()=>undefined),{workerId:`${hostname()}-${process.pid}`,limit:100,lockTimeoutSeconds:60,retryDelaySeconds:10});await repository.finishRun(runId,result.processed);return{runId,...result};
}catch(error){await repository.recordProviderError(runId,"postgres-outbox",error);await repository.failRun(runId,error);throw error;}}
