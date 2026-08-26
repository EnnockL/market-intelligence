-- Wallet Clustering has been implemented since early on but was never registered
-- with the scheduler, so wallet_cluster_snapshots/memberships never populate in
-- production. That starves both the wallet_independence qualification check and
-- the composite data-quality score (which averages in wallet.dataQuality, null
-- without a snapshot), making DATA_QUALITY_BELOW_THRESHOLD an near-universal
-- rejection reason regardless of how good the underlying opportunity is.
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'WALLET_CLUSTERING','WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));

insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('wallet-clustering-15m','WALLET_CLUSTERING','forecast-scheduler-v2.1',900,300,'HEALTHY',now(),'{"maxWallets":150}',8,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,enabled=excluded.enabled,next_run_at=least(public.scheduled_jobs.next_run_at,now()),updated_at=now();
