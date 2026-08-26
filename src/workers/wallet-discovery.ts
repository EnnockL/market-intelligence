import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { BlockchainDataProvider } from "@/services/blockchain/provider";

export async function runWalletDiscovery(provider: BlockchainDataProvider, repository: IngestionRepository, seeds: string[]) {
  const runId = await repository.startRun("wallet_discovery", provider.name);
  try {
    const discoverySeeds = await repository.walletDiscoverySeeds(seeds, 25);
    const candidates = await provider.discoverWalletCandidates(discoverySeeds);
    const processed = await repository.saveWalletDiscoveryCandidates(candidates, provider.name);
    await repository.finishRun(runId, processed);
    return { runId, status: "succeeded" as const, processed, candidates, discoverySeedCount: discoverySeeds.length };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error, { seeds });
    await repository.failRun(runId, error);
    throw error;
  }
}
