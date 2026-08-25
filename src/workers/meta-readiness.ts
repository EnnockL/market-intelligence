import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { MetaReadinessService } from "@/services/meta-readiness/service";
export async function runMetaReadiness(db: SupabaseClient, repository: IngestionRepository) { const runId = await repository.startRun("meta_readiness", "meta-readiness-policy-v1"); try { const result = await new MetaReadinessService(db).run(); await repository.finishRun(runId, result.created); return { runId, ...result }; } catch (error) { await repository.failRun(runId, error); throw error; } }
