create table public.agent_performance_snapshots (
  id uuid primary key default gen_random_uuid(), snapshot_key text not null unique,
  performance_version text not null, agent_id text not null, agent_version text not null,
  asset_class text not null, horizon text not null, market_regime text not null,
  data_quality_bucket text not null, information_cutoff_at timestamptz not null,
  available_at timestamptz not null, status text not null check(status in('AVAILABLE','INSUFFICIENT_DATA')),
  reason text, sample_size integer not null, directional_sample_size integer not null,
  leave_one_out_sample_size integer not null,
  independent_edge text not null check(independent_edge in('HIGH','MEDIUM','LOW','NOT_PROVEN')),
  metrics jsonb not null, input_ids jsonb not null, input_hash text not null,
  created_at timestamptz not null default now()
);
create index agent_performance_lookup_idx on public.agent_performance_snapshots(agent_id,agent_version,horizon,market_regime,data_quality_bucket,information_cutoff_at desc);
create trigger agent_performance_snapshots_immutable before update or delete on public.agent_performance_snapshots for each row execute function public.prevent_consensus_mutation();
alter table public.agent_performance_snapshots enable row level security;
create policy "public read agent performance" on public.agent_performance_snapshots for select using(true);
grant select on public.agent_performance_snapshots to anon,authenticated;
grant all on public.agent_performance_snapshots to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','CONSENSUS','AGENT_PERFORMANCE'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget)
values('agent-performance-1h','AGENT_PERFORMANCE','forecast-scheduler-v1.4',3600,900,'HEALTHY',now(),'{}') on conflict(job_key)do nothing;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance'));
