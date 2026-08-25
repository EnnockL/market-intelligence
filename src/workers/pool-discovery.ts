import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { PoolDiscoveryProvider } from "@/services/pool-discovery/provider";
import { PoolDiscoveryService } from "@/services/pool-discovery/service";

export async function runPoolDiscovery(db: SupabaseClient, repository: IngestionRepository, provider: PoolDiscoveryProvider, limit = 20) {
  const runId = await repository.startRun("pool_discovery", provider.name);
  try {
    const result = await new PoolDiscoveryService(db, provider).run(limit);
    for (const providerError of result.providerErrors) await repository.recordProviderError(runId, providerError.provider,
      Object.assign(new Error(providerError.message), { retryable: providerError.retryable }), { degradedFallback: true });
    await repository.finishRun(runId, result.observations);
    return { runId, ...result };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error);
    await repository.failRun(runId, error);
    throw error;
  }
}
