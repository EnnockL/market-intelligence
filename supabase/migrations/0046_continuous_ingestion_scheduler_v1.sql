alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS',
  'CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));

insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority)
values
  ('wallet-ingestion-5m','WALLET_INGESTION','forecast-scheduler-v1.3',300,240,'HEALTHY',now(),'{"solanaRpcRequests":120}',1),
  ('crypto-market-2m','CRYPTO_MARKET','forecast-scheduler-v1.3',120,180,'HEALTHY',now(),'{"providerRequests":100}',2),
  ('stock-ingestion-5m','STOCK_INGESTION','forecast-scheduler-v1.3',300,180,'HEALTHY',now(),'{"finnhubRequests":5}',3),
  ('wallet-discovery-1h','WALLET_DISCOVERY','forecast-scheduler-v1.3',3600,600,'HEALTHY',now(),'{"solanaRpcRequests":100}',4),
  ('market-events-1m','MARKET_EVENTS','forecast-scheduler-v1.3',60,180,'HEALTHY',now(),'{}',5),
  ('fast-flow-1m','FAST_FLOW','forecast-scheduler-v1.3',60,180,'HEALTHY',now(),'{}',6),
  ('jackpot-collector-1m','JACKPOT_COLLECTOR','forecast-scheduler-v1.3',60,180,'HEALTHY',now(),'{}',7)
on conflict(job_key) do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,updated_at=now();

update public.scheduled_jobs set priority=10 where job_type='NEWS_INGESTION';
update public.scheduled_jobs set priority=20 where job_type='CATALYST_CLASSIFICATION';
update public.scheduled_jobs set priority=30 where job_type='SPECIALIST_AGENTS';
update public.scheduled_jobs set priority=40 where job_type='MARKET_REGIME';
update public.scheduled_jobs set priority=50 where job_type='CONSENSUS';
update public.scheduled_jobs set priority=60 where job_type='AGENT_PERFORMANCE';
update public.scheduled_jobs set priority=70 where job_type='META_AGENT';
update public.scheduled_jobs set priority=80 where job_type='META_READINESS';
update public.scheduled_jobs set priority=90 where job_type='FORECAST_OUTCOME';
update public.scheduled_jobs set priority=100 where job_type='FORECAST_PERFORMANCE';
update public.scheduled_jobs set priority=110 where job_type='BASELINE_FORECAST';
