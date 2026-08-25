import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { ForecastSchedulerService, type SchedulerIngestionConfig, type SchedulerNewsConfig } from "@/services/forecast-scheduler/service";

export async function runForecastScheduler(db: SupabaseClient, repo: IngestionRepository, news?: SchedulerNewsConfig, ingestion?: SchedulerIngestionConfig) {
  const runId = await repo.startRun("forecast_scheduler", "postgres-scheduler-v1.4");
  try {
    const results = await new ForecastSchedulerService(db, undefined, news, ingestion).runDue();
    await repo.finishRun(runId, results.reduce((count, result) => count + (result.records ?? 0), 0));
    return { runId, jobs: results };
  } catch (error) {
    await repo.failRun(runId, error);
    throw error;
  }
}
