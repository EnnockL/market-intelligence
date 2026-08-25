import type { BlockchainDataProvider } from "@/services/blockchain/provider";
import type { IngestionRepository } from "@/repositories/ingestion-repository";

export async function runWalletIngestion(provider: BlockchainDataProvider, repository: IngestionRepository) {
  const runId = await repository.startRun("wallet_transactions", provider.name);
  let processed = 0;
  try {
    const wallets = await repository.trackedWallets();
    const backfillWalletIds = selectWalletsForBackfill(wallets, 3);
    for (const wallet of wallets) {
      const incremental = await provider.getWalletTransactions(wallet.address, { untilSignature: wallet.metadata?.last_signature, limit: 10, maxRequests: 11 });
      processed += await repository.saveWalletTransactions(wallet.id, incremental.transactions);
      if (incremental.newestSignature) await repository.updateWalletCursor(wallet.id, incremental.newestSignature);
      if (backfillWalletIds.has(wallet.id)) {
        const historical = await provider.getWalletTransactions(wallet.address, { beforeSignature: wallet.metadata?.backfill_before, limit: 40, maxRequests: 41 });
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

export function selectWalletsForBackfill(
  wallets: Array<{ id: string; address: string; metadata: { backfill_complete?: boolean; backfill_synced_at?: string } | null }>,
  limit: number,
) {
  return new Set(wallets
    .filter((wallet) => wallet.metadata?.backfill_complete !== true)
    .sort((left, right) => {
      const leftAt = left.metadata?.backfill_synced_at ?? "";
      const rightAt = right.metadata?.backfill_synced_at ?? "";
      return leftAt.localeCompare(rightAt) || left.address.localeCompare(right.address);
    })
    .slice(0, Math.max(0, limit))
    .map((wallet) => wallet.id));
}
