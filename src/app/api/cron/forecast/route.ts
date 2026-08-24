import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ForecastSchedulerService } from "@/services/forecast-scheduler/service";
import { FinnhubNewsProvider } from "@/services/news/finnhub-news-provider";
import { FinnhubProvider } from "@/services/market-data/finnhub-provider";
import { SolanaRpcProvider } from "@/services/blockchain/solana-rpc-provider";
import { DexScreenerProvider } from "@/services/crypto-market/dexscreener-provider";
import { GeckoTerminalProvider } from "@/services/crypto-market/geckoterminal-provider";
import { FreeCryptoMarketProvider } from "@/services/crypto-market/free-market-provider";
export const runtime = "nodejs";
export const maxDuration = 60;
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
    cryptoProvider: new FreeCryptoMarketProvider(new DexScreenerProvider(), new GeckoTerminalProvider()),
    stockSymbols: symbols,
    discoverySeeds,
  } : undefined;
  const startedAt = Date.now();
  const maxRuntimeMs = Math.max(5_000, Math.min(50_000, Number(process.env.SCHEDULER_MAX_RUNTIME_MS ?? 50_000)));
  const batchLimit = Math.max(1, Math.min(25, Number(process.env.SCHEDULER_BATCH_LIMIT ?? 20)));
  const service = new ForecastSchedulerService(createServiceClient(), `cron-${crypto.randomUUID()}`, key ? { provider: new FinnhubNewsProvider(key), symbols } : undefined, ingestion, { maxRuntimeMs });
  const jobs = await service.runDue(undefined, batchLimit);
  return NextResponse.json({ scheduler: "forecast-scheduler-v1.4", jobs, durationMs: Date.now() - startedAt, ranAt: new Date().toISOString() });
}
