import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PaperPortfolioService } from "@/services/paper-portfolio/service";
export async function runPaperExits(
  db: SupabaseClient,
  repository: IngestionRepository,
) {
  const id = await repository.startRun(
    "paper_exits",
    "crypto-market-observations",
  );
  try {
    const result = await new PaperPortfolioService(db).exits();
    await repository.finishRun(id, result.evaluated);
    return { runId: id, ...result };
  } catch (error) {
    await repository.failRun(id, error);
    throw error;
  }
}
