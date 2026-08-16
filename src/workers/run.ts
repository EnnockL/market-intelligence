import { getWorkerEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { IngestionRepository } from "@/repositories/ingestion-repository";
import { FinnhubProvider } from "@/services/market-data/finnhub-provider";
import { SolanaRpcProvider } from "@/services/blockchain/solana-rpc-provider";
import { runStockIngestion } from "./stock-ingestion";
import { runWalletIngestion } from "./wallet-ingestion";
import { runWalletDiscovery } from "./wallet-discovery";
import { runCryptoMarketIngestion } from "./crypto-market-ingestion";
import { runWalletPnl } from "./wallet-pnl";
import { DexScreenerProvider } from "@/services/crypto-market/dexscreener-provider";
import { CoinGeckoHistoricalProvider } from "@/services/crypto-market/coingecko-provider";

async function main() {
  const job = process.argv[2];
  if (!["stocks", "wallets", "wallet-discovery", "crypto-market", "wallet-pnl"].includes(job)) throw new Error("Usage: npm run worker -- stocks|wallets|wallet-discovery|crypto-market|wallet-pnl");
  const env = getWorkerEnv();
  const repository = new IngestionRepository(createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
  const result = job === "stocks"
    ? await runStockIngestion(new FinnhubProvider(env.FINNHUB_API_KEY), repository, env.STOCK_SYMBOLS.split(",").map((value) => value.trim()).filter(Boolean))
    : job === "wallets" ? await runWalletIngestion(new SolanaRpcProvider(env.SOLANA_RPC_URL), repository)
    : job === "wallet-discovery" ? await runWalletDiscovery(new SolanaRpcProvider(env.SOLANA_RPC_URL), repository, env.SOLANA_DISCOVERY_SEEDS.split(",").map((value) => value.trim()).filter(Boolean))
    : job === "crypto-market" ? await runCryptoMarketIngestion(new DexScreenerProvider(), repository)
    : await runWalletPnl(env.COINGECKO_API_KEY ? new CoinGeckoHistoricalProvider(env.COINGECKO_API_KEY) : new DexScreenerProvider(), repository);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
