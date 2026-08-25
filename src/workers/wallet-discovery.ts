import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { BlockchainDataProvider } from "@/services/blockchain/provider";

export async function runWalletDiscovery(provider: BlockchainDataProvider, repository: IngestionRepository, seeds: string[]) {
  const runId = await repository.startRun("wallet_discovery", provider.name);
  try {
    const candidates = await provider.discoverWalletCandidates([...new Set(seeds)]);
    const processed = await repository.saveWalletDiscoveryCandidates(candidates, provider.name);
    await repository.finishRun(runId, processed);
    return { runId, status: "succeeded" as const, processed, candidates };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error, { seeds });
    await repository.failRun(runId, error);
    throw error;
  }
}
