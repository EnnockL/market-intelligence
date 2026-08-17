import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { EcbHistoricalFxProvider } from "@/services/fx/ecb-provider";
import { FxRepository } from "@/services/fx/repository";
export async function runFx(db: SupabaseClient, repo: IngestionRepository) {
  const id = await repo.startRun("fx", "ecb");
  try {
    const end = new Date().toISOString().slice(0, 10),
      start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      rows = await new EcbHistoricalFxProvider().fetchRange(start, end),
      saved = await new FxRepository(db).save(rows);
    await repo.finishRun(id, saved);
    return { runId: id, observations: rows.length, saved };
  } catch (error) {
    await repo.failRun(id, error);
    throw error;
  }
}
