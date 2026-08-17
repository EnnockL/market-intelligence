import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PerformanceService } from "@/services/performance/service";
export async function runPerformance(
  db: SupabaseClient,
  repo: IngestionRepository,
) {
  const id = await repo.startRun("performance", "paper-portfolio");
  try {
    const result = await new PerformanceService(db).run();
    await repo.finishRun(id, result.created);
    return { runId: id, ...result };
  } catch (error) {
    await repo.failRun(id, error);
    throw error;
  }
}
