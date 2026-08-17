import { FAST_FLOW_POLICY, findFastFlowClusters } from "@/domain/opportunities";
import type { IngestionRepository } from "@/repositories/ingestion-repository";

export async function runFastFlow(repository: IngestionRepository, now = new Date()) {
  const runId = await repository.startRun("fast_flow", "event-outbox");
  let processed = 0;
  try {
    const cursor = await repository.fastFlowCursor();
    const overlapMs = FAST_FLOW_POLICY.windowSeconds * 1000;
    const since = cursor ? new Date(new Date(cursor.availableAt).getTime() - overlapMs).toISOString() : new Date(now.getTime() - 5 * 60_000).toISOString();
    const { events, safetyByAsset, nextCursor } = await repository.fastFlowInputs(since);
    const evaluations = findFastFlowClusters(events, safetyByAsset);
    for (const evaluation of evaluations) if (await repository.saveFastFlowEvaluation(evaluation)) processed += 1;
    if (nextCursor) await repository.updateFastFlowCursor(nextCursor);
    await repository.finishRun(runId, processed);
    return { runId, recordsProcessed: processed, evaluated: evaluations.length };
  } catch (error) {
    await repository.recordProviderError(runId, "event-outbox", error);
    await repository.failRun(runId, error);
    throw error;
  }
}
