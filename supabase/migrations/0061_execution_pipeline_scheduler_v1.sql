alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('execution-pipeline-1m','EXECUTION_PIPELINE','forecast-scheduler-v1.6',60,55,'HEALTHY',now(),'{}',85,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,enabled=excluded.enabled,updated_at=now();
