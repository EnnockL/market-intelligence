create table public.meta_assessments (
  id uuid primary key default gen_random_uuid(), assessment_key text not null unique,
  policy_version text not null, asset_id uuid not null references public.assets(id), horizon text not null,
  information_cutoff_at timestamptz not null, available_at timestamptz not null,
  decision text not null check(decision in('WATCH','REJECT','INSUFFICIENT_DATA')), reason text,
  consensus_snapshot_id uuid not null references public.consensus_snapshots(id),
  market_regime_snapshot_id uuid references public.market_regime_snapshots(id),
  input_performance_ids jsonb not null, requirements_passed jsonb not null,
  requirements_failed jsonb not null, requirements_unknown jsonb not null,
  ready_for_policy_evaluation boolean not null default false, data_quality integer,
  input_hash text not null, result_hash text not null, created_at timestamptz not null default now(),
  check(information_cutoff_at<=available_at)
);
create table public.meta_assessment_requirements (
  id uuid primary key default gen_random_uuid(), assessment_id uuid not null references public.meta_assessments(id),
  requirement_code text not null, status text not null check(status in('PASS','FAIL','UNKNOWN','NOT_APPLICABLE')),
  observed_value jsonb, required_value jsonb, blocker_code text, evidence_refs jsonb not null,
  created_at timestamptz not null default now(), unique(assessment_id,requirement_code)
);
create index meta_assessments_point_in_time_idx on public.meta_assessments(asset_id,horizon,information_cutoff_at desc,available_at);
create trigger meta_assessments_immutable before update or delete on public.meta_assessments for each row execute function public.prevent_consensus_mutation();
create trigger meta_assessment_requirements_immutable before update or delete on public.meta_assessment_requirements for each row execute function public.prevent_consensus_mutation();
alter table public.meta_assessments enable row level security; alter table public.meta_assessment_requirements enable row level security;
create policy "public read meta assessments" on public.meta_assessments for select using(true);
create policy "public read meta assessment requirements" on public.meta_assessment_requirements for select using(true);
grant select on public.meta_assessments,public.meta_assessment_requirements to anon,authenticated;
grant all on public.meta_assessments,public.meta_assessment_requirements to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget)
values('meta-agent-15m','META_AGENT','forecast-scheduler-v1.6',900,600,'HEALTHY',now(),'{}') on conflict(job_key)do nothing;
alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance','market_regime','meta_agent'));
