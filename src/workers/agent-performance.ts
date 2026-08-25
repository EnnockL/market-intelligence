import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { AgentPerformanceService } from "@/services/agent-performance/service";

export async function runAgentPerformance(db: SupabaseClient, repository: IngestionRepository) {
  const runId = await repository.startRun("agent_performance", "agent-performance-v1");
  try {
    const result = await new AgentPerformanceService(db).run();
    await repository.finishRun(runId, result.created);
    return { runId, ...result };
  } catch (error) {
    await repository.failRun(runId, error);
    throw error;
  }
}
