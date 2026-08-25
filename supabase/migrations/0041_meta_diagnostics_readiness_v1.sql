create table public.meta_readiness_snapshots(
  id uuid primary key default gen_random_uuid(), snapshot_key text not null unique, policy_version text not null,
  information_cutoff_at timestamptz not null, available_at timestamptz not null,
  status text not null check(status in('READY','COLLECTING','BLOCKED')), assessment_count integer not null,
  decision_coverage_pct numeric, ready_horizons jsonb not null, calibrated_horizons jsonb not null,
  blockers jsonb not null, input_assessment_ids jsonb not null, input_performance_ids jsonb not null,
  input_hash text not null, result_hash text not null, created_at timestamptz not null default now(),
  check(information_cutoff_at<=available_at)
);
create table public.meta_readiness_requirements(
  id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.meta_readiness_snapshots(id),
  requirement_code text not null, status text not null check(status in('PASS','FAIL','UNKNOWN')),
  observed_value jsonb, required_value jsonb, reason text, created_at timestamptz not null default now(), unique(snapshot_id,requirement_code)
);
create index meta_readiness_point_in_time_idx on public.meta_readiness_snapshots(information_cutoff_at desc,available_at);
create trigger meta_readiness_snapshots_immutable before update or delete on public.meta_readiness_snapshots for each row execute function public.prevent_consensus_mutation();
create trigger meta_readiness_requirements_immutable before update or delete on public.meta_readiness_requirements for each row execute function public.prevent_consensus_mutation();
alter table public.meta_readiness_snapshots enable row level security; alter table public.meta_readiness_requirements enable row level security;
create policy "public read meta readiness" on public.meta_readiness_snapshots for select using(true);
create policy "public read meta readiness requirements" on public.meta_readiness_requirements for select using(true);
grant select on public.meta_readiness_snapshots,public.meta_readiness_requirements to anon,authenticated;
grant all on public.meta_readiness_snapshots,public.meta_readiness_requirements to service_role;
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget)
values('meta-readiness-1h','META_READINESS','forecast-scheduler-v1.7',3600,600,'HEALTHY',now(),'{}') on conflict(job_key)do nothing;
alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance','market_regime','meta_agent','meta_readiness'));
