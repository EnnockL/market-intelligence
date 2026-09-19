-- Jobs are prepared disabled, then activated after the matching worker release.
alter table public.candle_sources drop constraint candle_sources_instrument_kind_check;
alter table public.candle_sources add constraint candle_sources_instrument_kind_check check(instrument_kind in('STOCK','FOREX','CRYPTO_POOL','CRYPTO_SPOT'));
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('STRATEGY_CANDIDATE_TRIAGE','FX_REFRESH','PROSPECTIVE_STRATEGY_EVALUATION','STRATEGY_RESEARCH_CYCLE','STRATEGY_VALIDATION_PROMOTION','STRATEGY_SIGNAL_PRODUCER','STRATEGY_SHADOW_EXECUTION','STRATEGY_VALIDATION_WINDOWS','STRATEGY_SHADOW_TRACKING','WALLET_CLUSTERING','WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR','BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));

insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('fx-refresh-6h','FX_REFRESH','forecast-scheduler-v2.2',21600,120,'PAUSED',now(),'{}',7,false),
('prospective-strategy-evaluation-1h','PROSPECTIVE_STRATEGY_EVALUATION','forecast-scheduler-v2.2',3600,240,'PAUSED',now(),'{}',6,false)
on conflict(job_key) do nothing;
