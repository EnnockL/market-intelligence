create table public.strategy_research_cycle_runs(
 id uuid primary key default gen_random_uuid(),cycle_key text not null unique,cycle_version text not null,
 strategy_definition_id uuid not null references public.strategy_definitions(id),hypothesis_id uuid not null references public.strategy_hypotheses(id),evaluation_run_id uuid not null references public.strategy_evaluation_runs(id),
 status text not null check(status in('COLLECTING','READY_FOR_VALIDATION','REJECTED','INSUFFICIENT_DATA')),
 blockers jsonb not null,progress jsonb not null,information_cutoff_at timestamptz not null,available_at timestamptz not null,result_hash text not null,created_at timestamptz not null default now(),
 check(available_at<=information_cutoff_at)
);
create index strategy_research_cycle_lookup_idx on public.strategy_research_cycle_runs(strategy_definition_id,information_cutoff_at desc);
create trigger strategy_research_cycle_runs_immutable before update or delete on public.strategy_research_cycle_runs for each row execute function public.prevent_strategy_lab_mutation();
alter table public.strategy_research_cycle_runs enable row level security;
create policy "public read strategy research cycle" on public.strategy_research_cycle_runs for select using(true);
grant select on public.strategy_research_cycle_runs to anon,authenticated;
grant all on public.strategy_research_cycle_runs to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('STRATEGY_RESEARCH_CYCLE','STRATEGY_VALIDATION_PROMOTION','STRATEGY_SIGNAL_PRODUCER','STRATEGY_SHADOW_EXECUTION','STRATEGY_VALIDATION_WINDOWS','STRATEGY_SHADOW_TRACKING','WALLET_CLUSTERING','WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR','BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('strategy-research-cycle-15m','STRATEGY_RESEARCH_CYCLE','forecast-scheduler-v2.1',900,240,'HEALTHY',now(),'{"maxCandidates":1}',6,true)
on conflict(job_key)do update set job_type=excluded.job_type,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,enabled=true,next_run_at=least(public.scheduled_jobs.next_run_at,now()),updated_at=now();

