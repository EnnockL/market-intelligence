import type { IngestionRepository } from "@/repositories/ingestion-repository";
import {
  unavailableHistorical,
  type CryptoMarketDataProvider,
} from "@/services/crypto-market/provider";
import { ProviderError } from "@/services/market-data/provider";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

export async function runWalletPnl(
  provider: CryptoMarketDataProvider,
  repository: IngestionRepository,
  maxTransactions = 10,
) {
  const runId = await repository.startRun("wallet_pnl", provider.name);
  let enriched = 0;
  let unavailable = 0;
  const errors: string[] = [];
  try {
    const transactions = await repository.walletTransactionsForEnrichment();
    const existing = await repository.enrichedTransactionIds(provider.name);
    const pending = selectFairEnrichmentBatch(
      transactions.filter((transaction) => !existing.has(transaction.id)),
      Math.max(1, Math.min(50, maxTransactions)),
    );
    for (const transaction of pending) {
      try {
        const tokenPoint = await provider.getHistorical({
          mintAddress: transaction.mintAddress,
          timestamp: transaction.occurred_at,
        });
        const solPoint = await provider.getHistorical({
          mintAddress: WRAPPED_SOL,
          timestamp: transaction.occurred_at,
        });
        const raw = transaction.raw_payload as { meta?: { fee?: number } } | null;
        await repository.saveTransactionEnrichment({
          transactionId: transaction.id,
          provider: provider.name,
          tokenPoint,
          solPoint,
          quantity: Number(transaction.quantity),
          rawFeeLamports:
            typeof raw?.meta?.fee === "number" ? raw.meta.fee : null,
        });
        enriched += 1;
      } catch (error) {
        errors.push(`${transaction.id}:${errorText(error)}`);
        await repository.recordProviderError(runId, provider.name, error);
        // A permanent provider response must not starve every later transaction.
        // Persist explicit UNKNOWN evidence; retryable failures remain pending.
        if (error instanceof ProviderError && !error.retryable) {
          const unavailableReason = {
            reason: "PERMANENT_PROVIDER_FAILURE",
            providerCode: error.code,
            providerStatus: error.status,
          };
          const raw = transaction.raw_payload as { meta?: { fee?: number } } | null;
          await repository.saveTransactionEnrichment({
            transactionId: transaction.id,
            provider: provider.name,
            tokenPoint: unavailableHistorical(
              transaction.mintAddress,
              transaction.occurred_at,
              provider.name,
              unavailableReason,
            ),
            solPoint: unavailableHistorical(
              WRAPPED_SOL,
              transaction.occurred_at,
              provider.name,
              unavailableReason,
            ),
            quantity: Number(transaction.quantity),
            rawFeeLamports:
              typeof raw?.meta?.fee === "number" ? raw.meta.fee : null,
          });
          unavailable += 1;
        }
      }
    }
    const cycles = await repository.rebuildWalletPnl(provider.name);
    await repository.finishRun(runId, enriched);
    return {
      runId,
      status: "succeeded" as const,
      considered: pending.length,
      enriched,
      unavailable,
      cycles,
      errors,
    };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error);
    await repository.failRun(runId, error);
    throw error;
  }
}

/**
 * Selects persisted transactions round-robin by wallet. A global oldest-first
 * slice lets one deep historical backfill consume every provider request and
 * prevents newly tracked wallets from ever receiving verification evidence.
 * Ordering remains deterministic inside and between wallet queues.
 */
export function selectFairEnrichmentBatch<
  T extends { id: string; wallet_id?: string | null; occurred_at: string },
>(transactions: T[], limit: number): T[] {
  const bounded = Math.max(0, Math.floor(limit));
  if (!bounded || !transactions.length) return [];
  const queues = new Map<string, T[]>();
  for (const transaction of transactions) {
    // Legacy/test rows without a wallet remain independently eligible instead
    // of being collapsed into one artificial wallet queue.
    const walletKey = transaction.wallet_id ?? `unknown:${transaction.id}`;
    const queue = queues.get(walletKey) ?? [];
    queue.push(transaction);
    queues.set(walletKey, queue);
  }
  for (const queue of queues.values())
    queue.sort(
      (left, right) =>
        left.occurred_at.localeCompare(right.occurred_at) ||
        left.id.localeCompare(right.id),
    );
  const orderedQueues = [...queues.entries()].sort(
    ([leftWallet, left], [rightWallet, right]) =>
      left[0].occurred_at.localeCompare(right[0].occurred_at) ||
      leftWallet.localeCompare(rightWallet),
  );
  const selected: T[] = [];
  for (let depth = 0; selected.length < bounded; depth += 1) {
    let found = false;
    for (const [, queue] of orderedQueues) {
      const transaction = queue[depth];
      if (!transaction) continue;
      selected.push(transaction);
      found = true;
      if (selected.length === bounded) break;
    }
    if (!found) break;
  }
  return selected;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
