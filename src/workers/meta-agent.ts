import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { MetaAgentService } from "@/services/meta-agent/service";

export async function runMetaAgent(db: SupabaseClient, repository: IngestionRepository) {
  const runId = await repository.startRun("meta_agent", "meta-agent-policy-v1");
  try { const result = await new MetaAgentService(db).run(); await repository.finishRun(runId, result.created); return { runId, ...result }; }
  catch (error) { await repository.failRun(runId, error); throw error; }
}
