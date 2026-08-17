import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PaperPortfolioService } from "@/services/paper-portfolio/service";
export async function runPaperExecution(
  db: SupabaseClient,
  repository: IngestionRepository,
) {
  const id = await repository.startRun(
    "paper_execution",
    "crypto-market-observations",
  );
  try {
    const result = await new PaperPortfolioService(db).execute();
    await repository.finishRun(
      id,
      result.filled + result.partial + result.rejected,
    );
    return { runId: id, ...result };
  } catch (error) {
    await repository.failRun(id, error);
    throw error;
  }
}
