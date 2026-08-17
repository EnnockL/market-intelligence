import { describe, expect, it, vi } from "vitest";
import { GeckoTerminalProvider } from "../src/services/crypto-market/geckoterminal-provider";

const mint = "So11111111111111111111111111111111111111112";
const pool = { id: "solana_pool", attributes: { address: "Pool111", name: "SOL / USDC", base_token_price_usd: "76", quote_token_price_usd: "1", reserve_in_usd: "25000000", market_cap_usd: null, volume_usd: { h24: "4000000" } }, relationships: { base_token: { data: { id: `solana_${mint}` } }, quote_token: { data: { id: "solana_USDC" } } } };

describe("GeckoTerminal keyless historical provider", () => {
  it("selects the most liquid pool and latest candle before the transaction", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("/ohlcv/")
      ? new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[1786874400, 3, 4, 2, 3.5, 10], [1786874340, 2, 3, 1, 2.5, 20]] } } }), { status: 200 })
      : new Response(JSON.stringify({ data: [{ ...pool, attributes: { ...pool.attributes, reserve_in_usd: "100" } }, pool] }), { status: 200 }));
    const result = await new GeckoTerminalProvider(fetcher).getHistorical({ mintAddress: mint, timestamp: "2026-08-16T10:00:00.000Z" });
    expect(result).toMatchObject({ priceUsd: 3.5, poolAddress: "Pool111", providerTimestamp: "2026-08-16T10:00:00.000Z", liquidityUsd: null, provider: "geckoterminal-public" });
    expect(result.rawPayload).toMatchObject({ historicalLiquidityUnavailable: true });
  });

  it("retries public rate limits before succeeding", async () => {
    let calls = 0; const fetcher = vi.fn(async () => ++calls < 3 ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ data: [pool] }), { status: 200 }));
    const result = await new GeckoTerminalProvider(fetcher).getCurrent([mint]);
    expect(calls).toBe(3); expect(result.points[0].priceUsd).toBe(76);
  });

  it("returns unavailable instead of fabricating a price when no pool exists", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await new GeckoTerminalProvider(fetcher).getHistorical({ mintAddress: mint, timestamp: "2026-08-16T10:00:00.000Z" });
    expect(result).toMatchObject({ priceUsd: null, completeness: "unavailable", confidence: 0 });
  });
});
