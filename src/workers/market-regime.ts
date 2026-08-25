import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { MarketRegimeService } from "@/services/market-regime/service";

export async function runMarketRegime(db: SupabaseClient, repository: IngestionRepository) {
  const runId = await repository.startRun("market_regime", "market-regime-policy-v1");
  try { const result = await new MarketRegimeService(db).run(); await repository.finishRun(runId, result.created); return { runId, ...result }; }
  catch (error) { await repository.failRun(runId, error); throw error; }
}
