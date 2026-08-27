create table public.strategy_signal_evaluations(
 id uuid primary key default gen_random_uuid(),evaluation_key text not null unique,producer_version text not null,
 strategy_definition_id uuid not null references public.strategy_definitions(id),validation_run_id uuid references public.strategy_validation_runs(id),runtime_assessment_id uuid not null references public.strategy_runtime_assessments(id),
 asset_id uuid references public.assets(id),decision text not null check(decision in('SIGNAL_CREATED','NO_TRADE','INSUFFICIENT_DATA')),blockers jsonb not null,evidence_refs jsonb not null,
 signal_id uuid,information_cutoff_at timestamptz not null,available_at timestamptz not null,result_hash text not null,created_at timestamptz not null default now(),check(available_at<=information_cutoff_at)
);
create table public.strategy_runtime_signals(
 id uuid primary key default gen_random_uuid(),signal_key text not null unique,signal_version text not null,
 strategy_attribution_id uuid not null references public.strategy_attribution_contexts(id),strategy_definition_id uuid not null references public.strategy_definitions(id),validation_run_id uuid not null references public.strategy_validation_runs(id),runtime_assessment_id uuid not null references public.strategy_runtime_assessments(id),asset_id uuid not null references public.assets(id),
 side text not null check(side in('LONG','SHORT')),setup_at timestamptz not null,entry numeric not null check(entry>0),stop numeric not null check(stop>0),target numeric not null check(target>0),expires_at timestamptz not null,
 evidence_refs jsonb not null,information_cutoff_at timestamptz not null,available_at timestamptz not null,input_hash text not null,created_at timestamptz not null default now(),check(available_at<=information_cutoff_at),check(setup_at<=information_cutoff_at)
);
alter table public.strategy_signal_evaluations add constraint strategy_signal_evaluations_signal_fk foreign key(signal_id) references public.strategy_runtime_signals(id);
create table public.strategy_shadow_trade_revisions(
 id uuid primary key default gen_random_uuid(),revision_key text not null unique,shadow_version text not null,signal_id uuid not null references public.strategy_runtime_signals(id),revision_number integer not null check(revision_number>0),state text not null check(state in('OPEN','CLOSED')),
 modeled_entry numeric not null,stress_entry numeric not null,exit_price numeric,exit_reason text,modeled_r numeric,stress_r numeric,fees_bps numeric not null,slippage_bps numeric not null,stress_slippage_bps numeric not null,
 evidence_refs jsonb not null,information_cutoff_at timestamptz not null,available_at timestamptz not null,result_hash text not null,created_at timestamptz not null default now(),check(available_at<=information_cutoff_at),unique(signal_id,revision_number),check((state='OPEN' and exit_price is null and exit_reason is null)or(state='CLOSED' and exit_price is not null and exit_reason is not null))
);
create index strategy_signal_evaluations_lookup_idx on public.strategy_signal_evaluations(strategy_definition_id,information_cutoff_at desc);
create index strategy_runtime_signals_lookup_idx on public.strategy_runtime_signals(strategy_definition_id,setup_at desc);
create index strategy_shadow_trade_revisions_lookup_idx on public.strategy_shadow_trade_revisions(signal_id,revision_number desc);
create trigger strategy_signal_evaluations_immutable before update or delete on public.strategy_signal_evaluations for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_runtime_signals_immutable before update or delete on public.strategy_runtime_signals for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_shadow_trade_revisions_immutable before update or delete on public.strategy_shadow_trade_revisions for each row execute function public.prevent_strategy_lab_mutation();
alter table public.strategy_signal_evaluations enable row level security;alter table public.strategy_runtime_signals enable row level security;alter table public.strategy_shadow_trade_revisions enable row level security;
create policy "public read strategy signal evaluations" on public.strategy_signal_evaluations for select using(true);create policy "public read strategy runtime signals" on public.strategy_runtime_signals for select using(true);create policy "public read strategy shadow trades" on public.strategy_shadow_trade_revisions for select using(true);
grant select on public.strategy_signal_evaluations,public.strategy_runtime_signals,public.strategy_shadow_trade_revisions to anon,authenticated;grant all on public.strategy_signal_evaluations,public.strategy_runtime_signals,public.strategy_shadow_trade_revisions to service_role;
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('STRATEGY_SIGNAL_PRODUCER','STRATEGY_SHADOW_EXECUTION','STRATEGY_VALIDATION_WINDOWS','STRATEGY_SHADOW_TRACKING','WALLET_CLUSTERING','WALLET_EVIDENCE','WALLET_PNL','WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR','BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)values
('strategy-signal-producer-1m','STRATEGY_SIGNAL_PRODUCER','forecast-scheduler-v2.1',60,50,'HEALTHY',now(),'{"maxStrategies":20}',3,true),
('strategy-shadow-execution-1m','STRATEGY_SHADOW_EXECUTION','forecast-scheduler-v2.1',60,50,'HEALTHY',now(),'{"maxPositions":50}',4,true)
on conflict(job_key)do update set job_type=excluded.job_type,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,enabled=true,next_run_at=least(public.scheduled_jobs.next_run_at,now()),updated_at=now();
