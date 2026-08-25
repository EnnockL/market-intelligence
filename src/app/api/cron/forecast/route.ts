import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ForecastSchedulerService } from "@/services/forecast-scheduler/service";
import { FinnhubNewsProvider } from "@/services/news/finnhub-news-provider";
import { FinnhubProvider } from "@/services/market-data/finnhub-provider";
import { SolanaRpcProvider } from "@/services/blockchain/solana-rpc-provider";
import { DexScreenerProvider } from "@/services/crypto-market/dexscreener-provider";
import { GeckoTerminalProvider } from "@/services/crypto-market/geckoterminal-provider";
import { FreeCryptoMarketProvider } from "@/services/crypto-market/free-market-provider";
import { BirdeyeHistoricalPriceProvider } from "@/services/crypto-market/birdeye-historical-provider";
export const runtime = "nodejs";
// Some bounded ingestion jobs make several upstream provider calls before they
// can persist their cursor. Pro deployments allow a longer function window;
// keep an explicit scheduler deadline below it so the request can finish and
// release its database lease cleanly.
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET, authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FINNHUB_API_KEY", "SOLANA_RPC_URL"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) return NextResponse.json({ error: "Missing production configuration", missing }, { status: 503 });
  const key = process.env.FINNHUB_API_KEY, rpcUrl = process.env.SOLANA_RPC_URL, symbols = (process.env.STOCK_SYMBOLS ?? "AAPL,NVDA,AMD,TSLA,MSFT").split(",").map((value) => value.trim()).filter(Boolean);
  const discoverySeeds = (process.env.SOLANA_DISCOVERY_SEEDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const ingestion = key && rpcUrl ? {
    stockProvider: new FinnhubProvider(key),
    blockchainProvider: new SolanaRpcProvider(rpcUrl),
    cryptoProvider: new FreeCryptoMarketProvider(
      new DexScreenerProvider(),
      new GeckoTerminalProvider(),
      process.env.BIRDEYE_API_KEY
        ? new BirdeyeHistoricalPriceProvider(process.env.BIRDEYE_API_KEY)
        : new GeckoTerminalProvider(),
    ),
    stockSymbols: symbols,
    discoverySeeds,
  } : undefined;
  const startedAt = Date.now();
  const maxRuntimeMs = Math.max(5_000, Math.min(240_000, Number(process.env.SCHEDULER_MAX_RUNTIME_MS ?? 240_000)));
  // One leased job per invocation prevents slow provider jobs from starving
  // the queue and lets the next minute continue from the persisted cursor.
  const batchLimit = Math.max(1, Math.min(5, Number(process.env.SCHEDULER_BATCH_LIMIT ?? 1)));
  const service = new ForecastSchedulerService(createServiceClient(), `cron-${crypto.randomUUID()}`, key ? { provider: new FinnhubNewsProvider(key), symbols } : undefined, ingestion, { maxRuntimeMs });
  const jobs = await service.runDue(undefined, batchLimit);
  return NextResponse.json({ scheduler: "forecast-scheduler-v1.4", jobs, durationMs: Date.now() - startedAt, ranAt: new Date().toISOString() });
}
