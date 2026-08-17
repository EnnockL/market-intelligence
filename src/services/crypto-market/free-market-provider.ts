import type { CryptoMarketBatch, CryptoMarketDataProvider, CryptoMarketPoint, HistoricalPriceRequest } from "./provider";

export class FreeCryptoMarketProvider implements CryptoMarketDataProvider {
  readonly name = "free-market-composite-v1";
  constructor(private readonly primary: CryptoMarketDataProvider, private readonly liquidityFallback: CryptoMarketDataProvider) {}

  async getCurrent(mintAddresses: string[]): Promise<CryptoMarketBatch> {
    const primary = await this.primary.getCurrent(mintAddresses);
    const missing = primary.points.filter((point) => point.liquidityUsd === null || !point.poolAddress).map((point) => point.mintAddress);
    if (!missing.length) return primary;
    const fallback = await this.liquidityFallback.getCurrent(missing);
    const fallbackByMint = new Map(fallback.points.map((point) => [point.mintAddress, point]));
    const points = primary.points.map((point): CryptoMarketPoint => {
      const replacement = fallbackByMint.get(point.mintAddress);
      return replacement?.liquidityUsd !== null && replacement?.poolAddress ? replacement : point;
    });
    return { points, rateLimit: primary.rateLimit };
  }

  getHistorical(request: HistoricalPriceRequest) { return this.liquidityFallback.getHistorical(request); }
}
