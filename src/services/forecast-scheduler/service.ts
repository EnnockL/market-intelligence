import type { SupabaseClient } from "@supabase/supabase-js";
import { BaselineForecastService } from "@/services/baseline-forecast/service";
import { ForecastOutcomeService } from "@/services/forecast-outcomes/service";
import { ForecastPerformanceService } from "@/services/forecast-performance/service";
import { NewsIngestionService } from "@/services/news/service";
import type { NewsProvider } from "@/services/news/provider";
import { CatalystClassificationService } from "@/services/catalyst-classification/service";
import { ConsensusService } from "@/services/consensus/service";
import { AgentPerformanceService } from "@/services/agent-performance/service";
import { MarketRegimeService } from "@/services/market-regime/service";
import { MetaAgentService } from "@/services/meta-agent/service";
import { MetaReadinessService } from "@/services/meta-readiness/service";
import { SpecialistAgentService } from "@/services/specialist-agents/service";
import {
  DEFAULT_SCHEDULER_RUNTIME_MS,
  schedulerBatchLimit,
  schedulerError,
  schedulerHasTime,
} from "@/domain/forecast-scheduler";
import type { MarketDataProvider } from "@/services/market-data/provider";
import type { BlockchainDataProvider } from "@/services/blockchain/provider";
import type { CryptoMarketDataProvider } from "@/services/crypto-market/provider";
import { IngestionRepository } from "@/repositories/ingestion-repository";
import { runStockIngestion } from "@/workers/stock-ingestion";
import { runWalletIngestion } from "@/workers/wallet-ingestion";
import { runWalletDiscovery } from "@/workers/wallet-discovery";
import { runCryptoMarketIngestion } from "@/workers/crypto-market-ingestion";
import { runMarketEvents } from "@/workers/market-events";
import { runFastFlow } from "@/workers/fast-flow";
import { runJackpotCollector } from "@/workers/jackpot-collector";
import { runCandleIngestion } from "@/workers/candle-ingestion";
import { OpenAIResponsesProvider } from "@/services/ai/openai-provider";
import { AIExplanationService } from "@/services/ai/explanation-service";
import { ExecutionPipelineService } from "@/services/execution-pipeline/service";
import { getWorkerEnv } from "@/lib/env";
import { DataGapClosureService } from "@/services/data-gap-closure/service";
import { BirdeyeHistoricalLiquidityProvider } from "@/services/liquidity/birdeye-liquidity-provider";
import { BirdeyeTokenRiskProvider } from "@/services/token-risk/birdeye-token-risk-provider";
import {
  FallbackTokenRiskProvider,
  SolanaRpcTokenRiskProvider,
} from "@/services/token-risk/solana-rpc-token-risk-provider";
import { QualificationDiagnosticsService } from "@/services/qualification/service";
import { TradeProposalProducerService } from "@/services/trade-proposal-producer/service";
import { CompositePoolDiscoveryProvider } from "@/services/pool-discovery/composite-provider";
import { GeckoTerminalPoolDiscoveryProvider } from "@/services/pool-discovery/geckoterminal-provider";
import { DexScreenerPoolDiscoveryProvider } from "@/services/pool-discovery/dexscreener-provider";
import { runPoolDiscovery } from "@/workers/pool-discovery";
import { runWalletPromotion } from "@/workers/wallet-promotion";
import { runWalletPnl } from "@/workers/wallet-pnl";
import { runWalletEvidence } from "@/workers/wallet-evidence";
import { runWalletClustering } from "@/workers/wallet-clustering";
import { runStrategyValidationWindows } from "@/workers/strategy-validation-windows";
import { runStrategyShadowTracking } from "@/workers/strategy-shadow-tracking";

export interface SchedulerNewsConfig {
  provider: NewsProvider;
  symbols: string[];
}
export interface SchedulerIngestionConfig {
  stockProvider: MarketDataProvider;
  blockchainProvider: BlockchainDataProvider;
  cryptoProvider: CryptoMarketDataProvider;
  stockSymbols: string[];
  discoverySeeds: string[];
}
export interface SchedulerOptions {
  maxRuntimeMs?: number;
}

export class ForecastSchedulerService {
  private readonly maxRuntimeMs: number;

  constructor(
    private db: SupabaseClient,
    private workerId = `scheduler-${process.pid}`,
    private news?: SchedulerNewsConfig,
    private ingestion?: SchedulerIngestionConfig,
    options: SchedulerOptions = {},
  ) {
    this.maxRuntimeMs = Math.max(
      5_000,
      options.maxRuntimeMs ?? DEFAULT_SCHEDULER_RUNTIME_MS,
    );
  }

  async runDue(now = new Date().toISOString(), requestedLimit?: number) {
    const startedAt = Date.now();
    const results = [];
    for (let index = 0; index < schedulerBatchLimit(requestedLimit); index++) {
      if (!schedulerHasTime(startedAt, Date.now(), this.maxRuntimeMs)) break;
      const result = await this.runOnce(now);
      if (!result.claimed) break;
      results.push(result);
    }
    return results;
  }

  async runOnce(now = new Date().toISOString()) {
    const { data, error } = await this.db.rpc("claim_forecast_scheduled_job", {
      p_worker_id: this.workerId,
      p_now: now,
    });
    if (error) throw error;
    const run = data?.[0];
    if (!run) return { claimed: false as const };
    const { data: job, error: jobError } = await this.db
      .from("scheduled_jobs")
      .select("*")
      .eq("id", run.job_id)
      .single();
    if (jobError) throw jobError;

    let heartbeatRunning = false;
    const heartbeat = async () => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      try {
        await this.db.rpc("heartbeat_forecast_scheduled_job", {
          p_run_id: run.id,
          p_worker_id: this.workerId,
          p_now: new Date().toISOString(),
        });
      } finally {
        heartbeatRunning = false;
      }
    };
    await heartbeat();
    const heartbeatMs = Math.max(
      5_000,
      Math.min(30_000, Number(job.lease_seconds ?? 180) * 333),
    );
    const timer = setInterval(() => {
      void heartbeat();
    }, heartbeatMs);
    timer.unref?.();
    try {
      const result = await this.execute(job, now);
      const records = Number(
        result.recordsProcessed ??
          result.processed ??
          result.evaluated ??
          result.completed ??
          result.created ??
          result.revisions ??
          result.inserted ??
          0,
      );
      const finished = await this.db.rpc("finish_forecast_scheduled_job", {
        p_run_id: run.id,
        p_worker_id: this.workerId,
        p_success: true,
        p_records: records,
        p_metrics: result,
        p_error: null,
        p_now: new Date().toISOString(),
      });
      if (finished.error) throw finished.error;
      return {
        claimed: true as const,
        jobKey: job.job_key,
        success: true,
        records,
        result,
      };
    } catch (cause) {
      const message = schedulerError(cause);
      await this.db.rpc("finish_forecast_scheduled_job", {
        p_run_id: run.id,
        p_worker_id: this.workerId,
        p_success: false,
        p_records: 0,
        p_metrics: {},
        p_error: message,
        p_now: new Date().toISOString(),
      });
      return {
        claimed: true as const,
        jobKey: job.job_key,
        success: false,
        error: message,
      };
    } finally {
      clearInterval(timer);
    }
  }

  private async execute(job: any, now: string): Promise<any> {
    const repo = new IngestionRepository(this.db);
    if (job.job_type === "STRATEGY_VALIDATION_WINDOWS")
      return runStrategyValidationWindows(this.db, now);
    if (job.job_type === "STRATEGY_SHADOW_TRACKING")
      return runStrategyShadowTracking(this.db, now);
    if (job.job_type === "POOL_DISCOVERY")
      return runPoolDiscovery(
        this.db,
        repo,
        new CompositePoolDiscoveryProvider([
          new GeckoTerminalPoolDiscoveryProvider(),
          new DexScreenerPoolDiscoveryProvider(),
        ]),
        Number(job.rate_limit_budget?.maxPools ?? 20),
      );
    if (job.job_type === "STOCK_INGESTION") {
      if (!this.ingestion)
        throw new Error("INGESTION_PROVIDERS_NOT_CONFIGURED");
      return runStockIngestion(
        this.ingestion.stockProvider,
        repo,
        this.ingestion.stockSymbols,
      );
    }
    if (job.job_type === "WALLET_INGESTION") {
      if (!this.ingestion)
        throw new Error("INGESTION_PROVIDERS_NOT_CONFIGURED");
      return runWalletIngestion(this.ingestion.blockchainProvider, repo);
    }
    if (job.job_type === "WALLET_DISCOVERY") {
      if (!this.ingestion)
        throw new Error("INGESTION_PROVIDERS_NOT_CONFIGURED");
      return runWalletDiscovery(
        this.ingestion.blockchainProvider,
        repo,
        this.ingestion.discoverySeeds,
      );
    }
    if (job.job_type === "WALLET_PROMOTION")
      return runWalletPromotion(this.db, now);
    if (job.job_type === "WALLET_CLUSTERING") {
      const env = getWorkerEnv();
      return runWalletClustering(
        this.db,
        repo,
        Math.max(
          2,
          Math.min(
            env.WALLET_CLUSTERING_MAX_WALLETS,
            Number(job.rate_limit_budget?.maxWallets ?? 150),
          ),
        ),
      );
    }
    if (job.job_type === "WALLET_EVIDENCE") {
      const env = getWorkerEnv();
      if (!env.BIRDEYE_API_KEY) throw new Error("BIRDEYE_API_KEY_REQUIRED");
      return runWalletEvidence(
        new BirdeyeHistoricalLiquidityProvider(env.BIRDEYE_API_KEY),
        new FallbackTokenRiskProvider(
          new BirdeyeTokenRiskProvider(env.BIRDEYE_API_KEY),
          new SolanaRpcTokenRiskProvider(env.SOLANA_RPC_URL),
        ),
        repo,
        Math.max(
          1,
          Math.min(
            env.WALLET_EVIDENCE_MAX_TOKENS,
            Number(job.rate_limit_budget?.maxTokens ?? 5),
          ),
        ),
        now,
      );
    }
    if (job.job_type === "WALLET_PNL") {
      if (!this.ingestion)
        throw new Error("INGESTION_PROVIDERS_NOT_CONFIGURED");
      return runWalletPnl(
        this.ingestion.cryptoProvider,
        repo,
        Math.max(
          1,
          Math.min(50, Number(job.rate_limit_budget?.maxTransactions ?? 10)),
        ),
      );
    }
    if (job.job_type === "CRYPTO_MARKET") {
      if (!this.ingestion)
        throw new Error("INGESTION_PROVIDERS_NOT_CONFIGURED");
      return runCryptoMarketIngestion(this.ingestion.cryptoProvider, repo);
    }
    if (job.job_type === "MARKET_EVENTS") return runMarketEvents(this.db, repo);
    if (job.job_type === "FAST_FLOW") return runFastFlow(this.db, repo);
    if (job.job_type === "JACKPOT_COLLECTOR")
      return runJackpotCollector(this.db, repo);
    if (job.job_type === "CANDLE_INGESTION") {
      if (!process.env.FINNHUB_API_KEY)
        throw new Error("FINNHUB_API_KEY_REQUIRED");
      return runCandleIngestion(this.db, process.env.FINNHUB_API_KEY);
    }
    if (job.job_type === "BASELINE_FORECAST")
      return new BaselineForecastService(this.db).run(now);
    if (job.job_type === "FORECAST_OUTCOME") {
      const limit = Math.max(
        1,
        Math.min(100, Number(job.rate_limit_budget?.batchSize ?? 25)),
      );
      const offset = Math.max(0, Number(job.metrics?.cursor?.offset ?? 0));
      return new ForecastOutcomeService(this.db).run(now, limit, offset);
    }
    if (job.job_type === "FORECAST_PERFORMANCE")
      return new ForecastPerformanceService(this.db).run(now);
    if (job.job_type === "SPECIALIST_AGENTS")
      return new SpecialistAgentService(this.db).run(100, now);
    if (job.job_type === "CATALYST_CLASSIFICATION")
      return new CatalystClassificationService(this.db).run(now);
    if (job.job_type === "CONSENSUS")
      return new ConsensusService(this.db).run(now);
    if (job.job_type === "AGENT_PERFORMANCE")
      return new AgentPerformanceService(this.db).run(now);
    if (job.job_type === "MARKET_REGIME")
      return new MarketRegimeService(this.db).run(now);
    if (job.job_type === "META_AGENT")
      return new MetaAgentService(this.db).run(now);
    if (job.job_type === "AI_EXPLANATION") {
      if (!process.env.OPENAI_API_KEY)
        throw new Error("OPENAI_API_KEY_REQUIRED");
      const limit = Math.max(
        1,
        Math.min(25, Number(job.rate_limit_budget?.maxExplanationsPerRun ?? 5)),
      );
      return new AIExplanationService(
        this.db,
        new OpenAIResponsesProvider(
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
        ),
      ).run(now, limit);
    }
    if (job.job_type === "META_READINESS")
      return new MetaReadinessService(this.db).run(now);
    if (job.job_type === "DATA_GAP_CLOSURE") {
      const env = getWorkerEnv();
      if (!env.BIRDEYE_API_KEY) throw new Error("BIRDEYE_API_KEY_REQUIRED");
      const risk = new FallbackTokenRiskProvider(
        new BirdeyeTokenRiskProvider(env.BIRDEYE_API_KEY),
        new SolanaRpcTokenRiskProvider(env.SOLANA_RPC_URL),
      );
      return new DataGapClosureService(
        this.db,
        new BirdeyeHistoricalLiquidityProvider(env.BIRDEYE_API_KEY),
        risk,
        repo,
      ).run(env.WALLET_EVIDENCE_MAX_TOKENS, now);
    }
    if (job.job_type === "QUALIFICATION")
      return new QualificationDiagnosticsService(this.db).run(now);
    if (job.job_type === "TRADE_PROPOSAL_PRODUCER")
      return new TradeProposalProducerService(this.db).run(now);
    if (job.job_type === "EXECUTION_PIPELINE")
      return new ExecutionPipelineService(this.db, getWorkerEnv()).run();
    if (job.job_type === "NEWS_INGESTION") {
      if (!this.news) throw new Error("NEWS_PROVIDER_NOT_CONFIGURED");
      const limit = Math.max(
        1,
        Math.min(
          100,
          Number(job.rate_limit_budget?.maxArticlesPerSymbol ?? 50),
        ),
      );
      return new NewsIngestionService(this.db, this.news.provider).run(
        this.news.symbols,
        now,
        limit,
      );
    }
    throw new Error(`UNKNOWN_SCHEDULED_JOB:${job.job_type}`);
  }
}
