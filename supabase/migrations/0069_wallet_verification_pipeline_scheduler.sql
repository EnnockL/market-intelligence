alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));

insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values
  ('wallet-evidence-15m','WALLET_EVIDENCE','forecast-scheduler-v2.0',900,300,'HEALTHY',now(),'{"maxTokens":5}',5,true),
  ('wallet-pnl-15m','WALLET_PNL','forecast-scheduler-v2.0',900,420,'HEALTHY',now(),'{"maxTransactions":10}',6,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,enabled=excluded.enabled,next_run_at=least(public.scheduled_jobs.next_run_at,now()),updated_at=now();

update public.scheduled_jobs set priority=4 where job_key='wallet-ingestion-5m';
update public.scheduled_jobs set priority=7 where job_key='wallet-promotion-15m';
