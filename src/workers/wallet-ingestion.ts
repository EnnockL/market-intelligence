import type { BlockchainDataProvider } from "@/services/blockchain/provider";
import type { IngestionRepository } from "@/repositories/ingestion-repository";

export async function runWalletIngestion(provider: BlockchainDataProvider, repository: IngestionRepository) {
  const runId = await repository.startRun("wallet_transactions", provider.name);
  let processed = 0;
  try {
    const wallets = await repository.trackedWallets();
    for (const wallet of wallets) {
      const batch = await provider.getWalletTransactions(wallet.address, wallet.metadata?.last_signature);
      processed += await repository.saveWalletTransactions(wallet.id, batch.transactions);
      if (batch.newestSignature) await repository.updateWalletCursor(wallet.id, batch.newestSignature);
    }
    await repository.finishRun(runId, processed);
    return { runId, recordsProcessed: processed };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error);
    await repository.failRun(runId, error);
    throw error;
  }
}

