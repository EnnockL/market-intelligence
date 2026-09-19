import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { CryptoMarketDataProvider, CryptoMarketPoint } from "@/services/crypto-market/provider";
import { ProviderError } from "@/services/market-data/provider";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

type WalletPnlBatch = {
  runId: string; considered: number; enriched: number; unavailable: number; recordsProcessed: number;
  cycles: number; walletsProcessed: number; blockedWallets: Array<{ walletId: string; reason: string }>;
  informationBlockers: string[]; errors: string[];
};

export class WalletPnlBatchError extends Error {
  readonly code = "WALLET_PNL_BATCH_PARTIAL";
  constructor(readonly result: WalletPnlBatch) {
    super(`WALLET_PNL_BATCH_PARTIAL: ${result.errors.length}/${result.considered} transactions failed; ${result.recordsProcessed} enrichments saved; ${result.blockedWallets.length} wallets blocked; ${result.cycles} cycles rebuilt`);
  }
}

export async function runWalletPnl(
  provider: CryptoMarketDataProvider,
  repository: IngestionRepository,
  maxTransactions = 10,
) {
  const historicalSource = provider.historicalProviderName ?? provider.name;
  const runId = await repository.startRun("wallet_pnl", historicalSource);
  let enriched = 0;
  let unavailable = 0;
  const errors: string[] = [];
  try {
    const budget = Math.max(1, Math.min(50, maxTransactions));
    // The database excludes completed records before limiting, and rotates
    // both wallets and retryable transactions using persisted attempt times.
    const pending = (await repository.walletTransactionsForEnrichment(historicalSource, budget)).slice(0, budget);
    for (const transaction of pending) {
      try {
        const tokenPoint = await provider.getHistorical({
          mintAddress: transaction.mintAddress,
          timestamp: transaction.occurred_at,
        });
        assertHistoricalPoint(tokenPoint, transaction.mintAddress, historicalSource);
        const solPoint = await provider.getHistorical({
          mintAddress: WRAPPED_SOL,
          timestamp: transaction.occurred_at,
        });
        assertHistoricalPoint(solPoint, WRAPPED_SOL, historicalSource);
        const raw = transaction.raw_payload as { meta?: { fee?: number } } | null;
        await repository.saveTransactionEnrichment({
          transactionId: transaction.id,
          provider: historicalSource,
          tokenPoint,
          solPoint,
          quantity: Number(transaction.quantity),
          rawFeeLamports:
            typeof raw?.meta?.fee === "number" ? raw.meta.fee : null,
        });
        // An explicit successful no-data response is evidence of a data gap,
        // unlike an authorization, schema or transport failure. Keep its count
        // separate without inventing a successful price or verification result.
        if (tokenPoint.completeness === "unavailable" || solPoint.completeness === "unavailable") unavailable += 1;
        else enriched += 1;
      } catch (error) {
        errors.push(`${transaction.id}:${errorText(error)}`);
        await repository.recordProviderError(runId, historicalSource, error);
        // retryable=false means the request should not immediately retry. It
        // does NOT prove that this transaction's historical data is absent.
        // Persist no enrichment on errors; the bounded DB queue rotates them.
      }
    }
    const rebuild = await repository.rebuildWalletPnl(historicalSource);
    const result: WalletPnlBatch = {
      runId,
      considered: pending.length,
      enriched,
      unavailable,
      recordsProcessed: enriched + unavailable,
      cycles: rebuild.cycles,
      walletsProcessed: rebuild.walletsProcessed,
      blockedWallets: rebuild.blocked,
      informationBlockers: rebuild.informationBlockers,
      errors,
    };
    if (errors.length || rebuild.blocked.length) throw new WalletPnlBatchError(result);
    await repository.finishRun(runId, result.recordsProcessed);
    return { ...result, status: "succeeded" as const };
  } catch (error) {
    const context = error instanceof WalletPnlBatchError ? {
      considered: error.result.considered, enriched: error.result.enriched, unavailable: error.result.unavailable,
      recordsProcessed: error.result.recordsProcessed, failedTransactions: error.result.errors.length,
      blockedWallets: error.result.blockedWallets.length, cycles: error.result.cycles,
      walletsProcessed: error.result.walletsProcessed,
    } : {};
    try { await repository.recordProviderError(runId, historicalSource, error, context); }
    finally { await repository.failRun(runId, error, enriched + unavailable); }
    throw error;
  }
}

function assertHistoricalPoint(point: CryptoMarketPoint, mint: string, provider: string) {
  const hasPrice = point?.priceUsd !== null && Number.isFinite(point?.priceUsd) && point.priceUsd! > 0;
  const explicitGap = point?.completeness === "unavailable" && point.priceUsd === null;
  if (!point || point.chain !== "solana" || point.mintAddress !== mint || point.provider !== provider
    || !Number.isFinite(Date.parse(point.observedAt))
    || point.providerTimestamp !== null && !Number.isFinite(Date.parse(point.providerTimestamp))
    || !(explicitGap || ["complete", "partial"].includes(point.completeness) && hasPrice)) {
    throw new ProviderError("Invalid historical price evidence", provider, "invalid_response", false);
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
