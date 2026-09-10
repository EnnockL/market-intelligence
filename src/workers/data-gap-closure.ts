import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { HistoricalLiquidityProvider } from "@/services/liquidity/provider";
import type { TokenRiskProvider } from "@/services/token-risk/provider";
import { DataGapClosureService } from "@/services/data-gap-closure/service";

type BatchResult = Awaited<ReturnType<DataGapClosureService["run"]>>;

class DataGapBatchError extends Error {
  readonly code = "DATA_GAP_BATCH_PARTIAL";
  constructor(readonly result: BatchResult, affected: number) {
    super(`DATA_GAP_BATCH_PARTIAL: ${affected}/${result.candidates} candidates had processing/provider failures; ${result.created} revisions committed`);
  }
}

export async function runDataGapClosure(
  db: SupabaseClient, repo: IngestionRepository, liquidity: HistoricalLiquidityProvider,
  risk: TokenRiskProvider, limit = 4,
) {
  const id = await repo.startRun("data_gap_closure", `${liquidity.name}+${risk.name}`);
  try {
    const result = await new DataGapClosureService(db, liquidity, risk, repo).run(limit);
    const affected = result.summaries.filter((row) => row.status === "FAILED" || row.errors.length > 0).length;
    // Successful partial commits remain immutable. Surface operational failures
    // to the scheduler rather than turning a mixed/failed batch into HEALTHY.
    if (affected) throw new DataGapBatchError(result, affected);
    await repo.finishRun(id, result.created);
    return { runId: id, ...result };
  } catch (error) {
    const context = error instanceof DataGapBatchError ? {
      candidates: error.result.candidates, committedRevisions: error.result.created,
      failedCandidates: error.result.failed, waitingEvidence: error.result.waitingEvidence,
    } : {};
    await repo.recordProviderError(id, "data-gap-closure", error, context);
    await repo.failRun(id, error);
    throw error;
  }
}
