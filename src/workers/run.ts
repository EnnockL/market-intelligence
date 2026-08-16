import { getWorkerEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { IngestionRepository } from "@/repositories/ingestion-repository";
import { FinnhubProvider } from "@/services/market-data/finnhub-provider";
import { SolanaRpcProvider } from "@/services/blockchain/solana-rpc-provider";
import { runStockIngestion } from "./stock-ingestion";
import { runWalletIngestion } from "./wallet-ingestion";

async function main() {
  const job = process.argv[2];
  if (job !== "stocks" && job !== "wallets") throw new Error("Usage: npm run worker -- stocks|wallets");
  const env = getWorkerEnv();
  const repository = new IngestionRepository(createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
  const result = job === "stocks"
    ? await runStockIngestion(new FinnhubProvider(env.FINNHUB_API_KEY), repository, env.STOCK_SYMBOLS.split(",").map((value) => value.trim()).filter(Boolean))
    : await runWalletIngestion(new SolanaRpcProvider(env.SOLANA_RPC_URL), repository);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });

