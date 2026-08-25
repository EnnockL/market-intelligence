alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));

insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled) values
  ('data-gap-closure-5m','DATA_GAP_CLOSURE','forecast-scheduler-v1.7',300,240,'HEALTHY',now(),'{"maxCandidates":10,"birdeyeRequests":20,"solanaRpcRequests":30}',9,true),
  ('qualification-2m','QUALIFICATION','forecast-scheduler-v1.7',120,90,'HEALTHY',now(),'{}',82,true),
  ('trade-proposal-producer-1m','TRADE_PROPOSAL_PRODUCER','forecast-scheduler-v1.7',60,45,'HEALTHY',now(),'{}',84,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,enabled=excluded.enabled,updated_at=now();
