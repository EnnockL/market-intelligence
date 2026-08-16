import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { CryptoMarketDataProvider } from "@/services/crypto-market/provider";

export async function runCryptoMarketIngestion(provider: CryptoMarketDataProvider, repository: IngestionRepository) {
  const runId = await repository.startRun("crypto_market", provider.name);
  try { const tokens = await repository.cryptoTokens(); const batch = await provider.getCurrent(tokens.map((item) => item.mint_address));
    const processed = await repository.saveCryptoMarketPoints(batch.points); await repository.finishRun(runId, processed); return { runId, status: "succeeded" as const, processed }; }
  catch (error) { await repository.recordProviderError(runId, provider.name, error); await repository.failRun(runId, error); throw error; }
}
