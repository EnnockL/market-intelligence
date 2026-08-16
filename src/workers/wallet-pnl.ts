import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { CryptoMarketDataProvider } from "@/services/crypto-market/provider";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
export async function runWalletPnl(provider: CryptoMarketDataProvider, repository: IngestionRepository) {
  const runId = await repository.startRun("wallet_pnl", provider.name); let enriched = 0;
  try { const transactions = await repository.walletTransactionsForEnrichment();
    for (const tx of transactions) { const [tokenPoint, solPoint] = await Promise.all([
      provider.getHistorical({ mintAddress: tx.mintAddress, timestamp: tx.occurred_at }), provider.getHistorical({ mintAddress: WRAPPED_SOL, timestamp: tx.occurred_at })]);
      const raw = tx.raw_payload as { meta?: { fee?: number } } | null; await repository.saveTransactionEnrichment({ transactionId: tx.id, provider: provider.name,
        tokenPoint, solPoint, quantity: Number(tx.quantity), rawFeeLamports: typeof raw?.meta?.fee === "number" ? raw.meta.fee : null }); enriched += 1; }
    const cycles = await repository.rebuildWalletPnl(provider.name); await repository.finishRun(runId, enriched); return { runId, status: "succeeded" as const, enriched, cycles }; }
  catch (error) { await repository.recordProviderError(runId, provider.name, error); await repository.failRun(runId, error); throw error; }
}
