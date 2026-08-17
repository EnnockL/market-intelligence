import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { QualificationDiagnosticsService } from "@/services/qualification/service";
export async function runQualification(db: SupabaseClient, repo: IngestionRepository) {
  const id = await repo.startRun("qualification", "qualification-diagnostics-v1");
  try { const result = await new QualificationDiagnosticsService(db).run(); await repo.finishRun(id, result.created); return { runId: id, ...result }; }
  catch (error) { await repo.failRun(id, error); throw error; }
}
