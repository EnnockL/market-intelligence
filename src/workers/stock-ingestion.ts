import type { MarketDataProvider } from "@/services/market-data/provider";
import type { IngestionRepository } from "@/repositories/ingestion-repository";

export async function runStockIngestion(provider: MarketDataProvider, repository: IngestionRepository, symbols: string[]) {
  const runId = await repository.startRun("stock_quotes", provider.name);
  try {
    const quotes = await provider.getQuotes(symbols);
    await repository.saveStockQuotes(quotes);
    await repository.finishRun(runId, quotes.length);
    return { runId, recordsProcessed: quotes.length };
  } catch (error) {
    await repository.recordProviderError(runId, provider.name, error, { symbols });
    await repository.failRun(runId, error);
    throw error;
  }
}

