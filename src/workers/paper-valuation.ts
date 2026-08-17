import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { PaperPortfolioService } from "@/services/paper-portfolio/service";
export async function runPaperValuation(
  db: SupabaseClient,
  repository: IngestionRepository,
) {
  const id = await repository.startRun(
    "paper_valuation",
    "crypto-market-observations",
  );
  try {
    const result = await new PaperPortfolioService(db).valuation();
    await repository.finishRun(id, result.valued);
    return { runId: id, ...result };
  } catch (error) {
    await repository.failRun(id, error);
    throw error;
  }
}
