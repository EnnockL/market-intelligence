import type { CryptoMarketBatch, CryptoMarketDataProvider, CryptoMarketPoint, HistoricalPriceRequest } from "./provider";

export class FreeCryptoMarketProvider implements CryptoMarketDataProvider {
  readonly name = "free-market-composite-v1";
  private static readonly MAX_FALLBACK_TOKENS_PER_RUN = 5;
  constructor(private readonly primary: CryptoMarketDataProvider, private readonly liquidityFallback: CryptoMarketDataProvider) {}

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    const primary = await this.primary.getCurrent(mintAddresses);
    const missing = primary.points.filter((point) => point.liquidityUsd === null || !point.poolAddress).map((point) => point.mintAddress);
    if (!missing.length) return primary;
    // The primary observations remain valid when the optional public liquidity
    // fallback is unavailable or rate limited. Preserve them instead of failing
    // the complete ingestion run; missing fields stay explicitly null.
    let fallback: CryptoMarketBatch;
    try {
      fallback = await this.liquidityFallback.getCurrent(
        missing.slice(0, FreeCryptoMarketProvider.MAX_FALLBACK_TOKENS_PER_RUN),
      );
    } catch {
      return primary;
    }
    const fallbackByMint = new Map(fallback.points.map((point) => [point.mintAddress, point]));
    const points = primary.points.map((point): CryptoMarketPoint => {
      const replacement = fallbackByMint.get(point.mintAddress);
      return replacement?.liquidityUsd !== null && replacement?.poolAddress ? replacement : point;
    });
    return { points, rateLimit: primary.rateLimit };
  }

  getHistorical(request: HistoricalPriceRequest) { return this.liquidityFallback.getHistorical(request); }
}
