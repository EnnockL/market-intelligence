import type { BlockchainDataProvider } from "@/services/blockchain/provider";
import type { IngestionRepository } from "@/repositories/ingestion-repository";

export async function runWalletIngestion(provider: BlockchainDataProvider, repository: IngestionRepository) {
  const runId = await repository.startRun("wallet_transactions", provider.name);
  let processed = 0;
  try {
    const wallets = await repository.trackedWallets();
    for (const wallet of wallets) {
      const incremental = await provider.getWalletTransactions(wallet.address, { untilSignature: wallet.metadata?.last_signature, limit: 10, maxRequests: 11 });
      processed += await repository.saveWalletTransactions(wallet.id, incremental.transactions);
      if (incremental.newestSignature) await repository.updateWalletCursor(wallet.id, incremental.newestSignature);
      if (!wallet.metadata?.backfill_complete) {
        const historical = await provider.getWalletTransactions(wallet.address, { beforeSignature: wallet.metadata?.backfill_before, limit: 25, maxRequests: 26 });
        processed += await repository.saveWalletTransactions(wallet.id, historical.transactions);
        await repository.updateWalletBackfillCursor(wallet.id, historical.oldestSignature, !historical.hasMore || !historical.oldestSignature);
      }
    }
    await repository.finishRun(runId, processed);
    return { runId, recordsProcessed: processed };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error);
    await repository.failRun(runId, error);
    throw error;
  }
}
