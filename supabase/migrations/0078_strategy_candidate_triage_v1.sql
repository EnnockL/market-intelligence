create table public.strategy_candidate_triage_runs(
 id uuid primary key default gen_random_uuid(), triage_key text not null unique, triage_version text not null,
 strategy_definition_id uuid not null references public.strategy_definitions(id), recommendation text not null check(recommendation in('PRIORITIZE','COLLECT_MORE_DATA','DO_NOT_PRIORITIZE','EXCLUDED_REJECTED')),
 rank integer, input_evaluation_run_ids jsonb not null, metrics jsonb not null, blockers jsonb not null,
 information_cutoff_at timestamptz not null, available_at timestamptz not null, result_hash text not null, created_at timestamptz not null default now(),
 check(available_at<=information_cutoff_at)
);
create index strategy_candidate_triage_lookup_idx on public.strategy_candidate_triage_runs(recommendation,rank,information_cutoff_at desc);
create trigger strategy_candidate_triage_runs_immutable before update or delete on public.strategy_candidate_triage_runs for each row execute function public.prevent_strategy_lab_mutation();
alter table public.strategy_candidate_triage_runs enable row level security;
create policy "public read strategy candidate triage" on public.strategy_candidate_triage_runs for select using(true);
grant select on public.strategy_candidate_triage_runs to anon,authenticated;
grant all on public.strategy_candidate_triage_runs to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('STRATEGY_CANDIDATE_TRIAGE','STRATEGY_RESEARCH_CYCLE','STRATEGY_VALIDATION_PROMOTION','STRATEGY_SIGNAL_PRODUCER','STRATEGY_SHADOW_EXECUTION','STRATEGY_VALIDATION_WINDOWS','STRATEGY_SHADOW_TRACKING','WALLET_CLUSTERING','WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR','BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('strategy-candidate-triage-1h','STRATEGY_CANDIDATE_TRIAGE','forecast-scheduler-v2.1',3600,240,'PAUSED',now(),'{}',6,false)
on conflict(job_key) do update set job_type=excluded.job_type,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,updated_at=now();
