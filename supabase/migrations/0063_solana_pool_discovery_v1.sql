create table public.pool_discovery_observations(
  id uuid primary key default gen_random_uuid(),
  discovery_key text not null unique,
  asset_id uuid not null references public.assets(id),
  chain text not null check(chain='solana'),
  mint_address text not null,
  pool_address text,
  provider text not null,
  source_reference text not null,
  pool_created_at timestamptz,
  observed_at timestamptz not null,
  available_at timestamptz not null,
  price_usd numeric(30,12), liquidity_usd numeric(30,2), volume_24h_usd numeric(30,2), market_cap_usd numeric(30,2),
  confidence smallint not null check(confidence between 0 and 100),
  data_quality smallint not null check(data_quality between 0 and 100),
  raw_payload jsonb not null default'{}',
  created_at timestamptz not null default now(),
  check(observed_at<=available_at),
  check(pool_created_at is null or pool_created_at<=available_at)
);
create index pool_discovery_timeline_idx on public.pool_discovery_observations(available_at desc,provider);
create index pool_discovery_asset_idx on public.pool_discovery_observations(asset_id,available_at desc);
alter table public.pool_discovery_observations enable row level security;
grant all privileges on public.pool_discovery_observations to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance','market_regime','meta_agent','meta_readiness','strategy_pattern_lab','candle_ingestion','ai_explanations','strategy_intelligence','execution','trade_eligibility','account_state','execution_bridge','trade_proposal_producer','pool_discovery'));

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('solana-pool-discovery-2m','POOL_DISCOVERY','forecast-scheduler-v1.8',120,90,'HEALTHY',now(),'{}',5,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,enabled=excluded.enabled,updated_at=now();

