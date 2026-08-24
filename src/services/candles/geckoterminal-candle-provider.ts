import { z } from "zod";
import { ProviderError } from "@/services/market-data/provider";
import { timeframeSeconds, type CandleBatch, type CandleRequest, type HistoricalCandleProvider } from "./provider";

const schema = z.object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])) }) }) });
export class GeckoTerminalCandleProvider implements HistoricalCandleProvider {
  readonly name = "geckoterminal-ohlcv";
  constructor(private fetcher: typeof fetch = fetch, private baseUrl = "https://api.geckoterminal.com/api/v2") {}
  async getCandles(request: CandleRequest): Promise<CandleBatch> {
    if (request.instrumentKind !== "CRYPTO_POOL") throw new ProviderError("GeckoTerminal candles require a pool", this.name, "invalid_response", false);
    const { unit, aggregate } = geckoTimeframe(request.timeframe), limit = Math.max(1, Math.min(1000, request.limit ?? 1000));
    const before = Math.floor(Date.parse(request.cursor ?? request.endsAt) / 1000), url = `${this.baseUrl}/networks/solana/pools/${encodeURIComponent(request.providerSymbol)}/ohlcv/${unit}?aggregate=${aggregate}&before_timestamp=${before}&limit=${limit}&currency=usd&token=${request.tokenSide ?? "base"}`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) { response = await this.fetcher(url, { headers: { accept: "application/json;version=20230302" } }); if (response.status !== 429) break; await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000))); }
    if (!response || response.status === 429) throw new ProviderError("GeckoTerminal candle rate limit reached", this.name, "rate_limited", true, 429);
    if (!response.ok) throw new ProviderError(`GeckoTerminal candles returned HTTP ${response.status}`, this.name, "unavailable", response.status >= 500, response.status);
    const parsed = schema.safeParse(await response.json()); if (!parsed.success) throw new ProviderError("GeckoTerminal returned invalid candle data", this.name, "invalid_response", false);
    const duration = timeframeSeconds(request.timeframe), observedAt = new Date().toISOString();
    const candles = parsed.data.data.attributes.ohlcv_list.map(item => { const closedAt = new Date((item[0] + duration) * 1000).toISOString(); return { id: `${this.name}:${request.providerSymbol}:${request.timeframe}:${item[0]}`, assetId: request.assetId, provider: this.name, timeframe: request.timeframe, openedAt: new Date(item[0] * 1000).toISOString(), closedAt, observedAt, availableAt: closedAt, open: item[1], high: item[2], low: item[3], close: item[4], volume: item[5], dataQuality: 90, rawPayload: { pool: request.providerSymbol, tokenSide: request.tokenSide ?? "base" } }; }).filter(item => item.openedAt >= request.startsAt && item.closedAt <= request.endsAt).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    const oldest = candles[0]; return { candles, nextCursor: oldest && oldest.openedAt > request.startsAt && candles.length === limit ? oldest.openedAt : null, rateLimit: { remaining: null, resetAt: null } };
  }
}
function geckoTimeframe(timeframe: string) { const map: Record<string, { unit: string; aggregate: number }> = { "1m": { unit: "minute", aggregate: 1 }, "5m": { unit: "minute", aggregate: 5 }, "15m": { unit: "minute", aggregate: 15 }, "1h": { unit: "hour", aggregate: 1 }, "4h": { unit: "hour", aggregate: 4 }, "1d": { unit: "day", aggregate: 1 } }; const value = map[timeframe]; if (!value) throw new Error(`UNSUPPORTED_GECKO_TIMEFRAME:${timeframe}`); return value; }
