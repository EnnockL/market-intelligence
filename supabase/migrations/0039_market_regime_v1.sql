create table public.market_regime_snapshots(
  id uuid primary key default gen_random_uuid(), snapshot_key text not null unique,
  policy_version text not null, scope text not null check(scope in('STOCK','CRYPTO','GLOBAL')),
  regime text not null check(regime in('RISK_ON','RISK_OFF','SIDEWAYS','UNKNOWN')), reason text,
  information_cutoff_at timestamptz not null, available_at timestamptz not null,
  sample_size integer not null, expected_assets integer not null, coverage_pct numeric not null,
  data_quality integer, confidence integer, evidence_refs jsonb not null, result_hash text not null,
  created_at timestamptz not null default now(), check(information_cutoff_at<=available_at)
);
create table public.market_regime_components(
  id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.market_regime_snapshots(id),
  component_code text not null, value numeric, status text not null check(status in('AVAILABLE','UNKNOWN')),
  created_at timestamptz not null default now(), unique(snapshot_id,component_code)
);
create index market_regime_point_in_time_idx on public.market_regime_snapshots(scope,information_cutoff_at desc,available_at);
create trigger market_regime_snapshots_immutable before update or delete on public.market_regime_snapshots for each row execute function public.prevent_consensus_mutation();
create trigger market_regime_components_immutable before update or delete on public.market_regime_components for each row execute function public.prevent_consensus_mutation();
alter table public.market_regime_snapshots enable row level security; alter table public.market_regime_components enable row level security;
create policy "public read market regimes" on public.market_regime_snapshots for select using(true);
create policy "public read market regime components" on public.market_regime_components for select using(true);
grant select on public.market_regime_snapshots,public.market_regime_components to anon,authenticated;
grant all on public.market_regime_snapshots,public.market_regime_components to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget)
values('market-regime-15m','MARKET_REGIME','forecast-scheduler-v1.5',900,600,'HEALTHY',now(),'{}') on conflict(job_key)do nothing;
alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance','market_regime'));
