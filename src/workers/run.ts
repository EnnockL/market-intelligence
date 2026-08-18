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
import { runWalletEvidence } from "./wallet-evidence";
import { BirdeyeHistoricalLiquidityProvider } from "@/services/liquidity/birdeye-liquidity-provider";
import { BirdeyeTokenRiskProvider } from "@/services/token-risk/birdeye-token-risk-provider";
import { DexScreenerProvider } from "@/services/crypto-market/dexscreener-provider";
import { CoinGeckoHistoricalProvider } from "@/services/crypto-market/coingecko-provider";
import { GeckoTerminalProvider } from "@/services/crypto-market/geckoterminal-provider";
import { FreeCryptoMarketProvider } from "@/services/crypto-market/free-market-provider";
import { runFastFlow } from "./fast-flow";
import { runWalletClustering } from "./wallet-clustering";
import { runJackpotCollector } from "./jackpot-collector";
import { runJackpotOutcomes } from "./jackpot-outcomes";
import { runMarketEvents } from "./market-events";
import { runPaperEligibility } from "./paper-eligibility";
import { runPaperExecution } from "./paper-execution";
import { runPaperExits } from "./paper-exits";
import { runPaperValuation } from "./paper-valuation";
import { runPerformance } from "./performance";
import { runFx } from "./fx";
import { runQualification } from "./qualification";
import { runDataGapClosure } from "./data-gap-closure";
import { runSimulation } from "./simulation";
import { runHistoricalReplay } from "./historical-replay";
import { runForecastCatalyst } from "./forecast-catalyst";
import { runExpertKnowledge } from "./expert-knowledge";
import { runBaselineForecast } from "./baseline-forecast";
import { runForecastPerformance } from "./forecast-performance";
import { runForecastScheduler } from "./forecast-scheduler";
import { runSpecialistAgents } from "./specialist-agents";
import { runNewsIngestion } from "./news-ingestion";
import { FinnhubNewsProvider } from "@/services/news/finnhub-news-provider";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const job = process.argv[2];
  if (
    ![
      "stocks",
      "wallets",
      "wallet-discovery",
      "crypto-market",
      "wallet-pnl",
      "wallet-evidence",
      "wallet-clustering",
      "fast-flow",
      "jackpot-collector",
      "jackpot-outcomes",
      "market-events",
      "paper-eligibility",
      "paper-execution",
      "paper-exits",
      "paper-valuation",
      "performance",
      "fx",
      "qualification",
      "data-gap-closure",
      "simulation",
      "historical-replay",
      "forecast-catalyst",
      "expert-knowledge",
      "baseline-forecast",
      "forecast-performance",
      "forecast-scheduler",
      "specialist-agents",
      "news-ingestion",
    ].includes(job)
  )
    throw new Error("Unknown worker job");
  const env = getWorkerEnv();
  const db = createServiceClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const repository = new IngestionRepository(db);
  const result =
    job === "news-ingestion" ? await runNewsIngestion(db,repository,new FinnhubNewsProvider(env.FINNHUB_API_KEY),env.STOCK_SYMBOLS.split(",").map(value=>value.trim()).filter(Boolean)) : job === "specialist-agents" ? await runSpecialistAgents(db, repository) : job === "forecast-scheduler" ? await runForecastScheduler(db, repository) : job === "forecast-performance" ? await runForecastPerformance(db, repository) : job === "baseline-forecast" ? await runBaselineForecast(db, repository) : job === "expert-knowledge" ? await runExpertKnowledge(db, repository) : job === "forecast-catalyst" ? await runForecastCatalyst(db, repository) : job === "historical-replay" ? await runHistoricalReplay(db, repository) : job === "simulation" ? await runSimulation(db, repository) : job === "data-gap-closure"
      ? env.BIRDEYE_API_KEY
        ? await runDataGapClosure(db, repository, new BirdeyeHistoricalLiquidityProvider(env.BIRDEYE_API_KEY), new BirdeyeTokenRiskProvider(env.BIRDEYE_API_KEY), env.WALLET_EVIDENCE_MAX_TOKENS)
        : (()=>{throw new Error("BIRDEYE_API_KEY is required for data-gap-closure")})()
      : job === "qualification"
      ? await runQualification(db, repository)
      : job === "fx"
      ? await runFx(db, repository)
      : job === "performance"
        ? await runPerformance(db, repository)
        : job === "paper-eligibility"
          ? await runPaperEligibility(db, repository)
          : job === "paper-execution"
            ? await runPaperExecution(db, repository)
            : job === "paper-exits"
              ? await runPaperExits(db, repository)
              : job === "paper-valuation"
                ? await runPaperValuation(db, repository)
                : job === "fast-flow"
                  ? await runFastFlow(db, repository)
                  : job === "market-events"
                    ? await runMarketEvents(db, repository)
                    : job === "jackpot-collector"
                      ? await runJackpotCollector(db, repository)
                      : job === "jackpot-outcomes"
                        ? await runJackpotOutcomes(db, repository)
                        : job === "wallet-clustering"
                          ? await runWalletClustering(
                              db,
                              repository,
                              env.WALLET_CLUSTERING_MAX_WALLETS,
                            )
                          : job === "stocks"
                            ? await runStockIngestion(
                                new FinnhubProvider(env.FINNHUB_API_KEY),
                                repository,
                                env.STOCK_SYMBOLS.split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              )
                            : job === "wallets"
                              ? await runWalletIngestion(
                                  new SolanaRpcProvider(env.SOLANA_RPC_URL),
                                  repository,
                                )
                              : job === "wallet-discovery"
                                ? await runWalletDiscovery(
                                    new SolanaRpcProvider(env.SOLANA_RPC_URL),
                                    repository,
                                    env.SOLANA_DISCOVERY_SEEDS.split(",")
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  )
                                : job === "crypto-market"
                                  ? await runCryptoMarketIngestion(
                                      new FreeCryptoMarketProvider(
                                        new DexScreenerProvider(),
                                        new GeckoTerminalProvider(),
                                      ),
                                      repository,
                                    )
                                  : job === "wallet-evidence"
                                    ? env.BIRDEYE_API_KEY
                                      ? await runWalletEvidence(
                                          new BirdeyeHistoricalLiquidityProvider(
                                            env.BIRDEYE_API_KEY,
                                          ),
                                          new BirdeyeTokenRiskProvider(
                                            env.BIRDEYE_API_KEY,
                                          ),
                                          repository,
                                          env.WALLET_EVIDENCE_MAX_TOKENS,
                                        )
                                      : (() => {
                                          throw new Error(
                                            "BIRDEYE_API_KEY is required for wallet-evidence",
                                          );
                                        })()
                                    : await runWalletPnl(
                                        env.COINGECKO_API_KEY
                                          ? new CoinGeckoHistoricalProvider(
                                              env.COINGECKO_API_KEY,
                                            )
                                          : new GeckoTerminalProvider(),
                                        repository,
                                      );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
