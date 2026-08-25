import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { SimulationService } from "@/services/simulation/service";
export async function runSimulation(db:SupabaseClient,repository:IngestionRepository){const ingestionRunId=await repository.startRun("simulation","simulation-engine-v1");try{const end=new Date(),start=new Date(end.getTime()-90*86400000);const result=await new SimulationService(db).run({initialCapitalSek:20_000,startsAt:start.toISOString(),endsAt:end.toISOString(),policy:"FIXED_SMALL"});await repository.finishRun(ingestionRunId,1);return{ingestionRunId,...result};}catch(e){await repository.failRun(ingestionRunId,e);throw e;}}
