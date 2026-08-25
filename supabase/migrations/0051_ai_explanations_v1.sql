create table public.ai_explanations(
  id uuid primary key default gen_random_uuid(), explanation_key text not null unique, contract_version text not null,
  entity_type text not null check(entity_type in('META_ASSESSMENT','SPECIALIST_ANALYSIS')), entity_id uuid not null, asset_id uuid not null references public.assets(id),
  information_cutoff_at timestamptz not null, available_at timestamptz not null, provider text not null, model text not null, prompt_version text not null,
  status text not null default 'COMPLETED' check(status in('COMPLETED','REFUSED','FAILED')), summary text not null,
  reasoning jsonb not null default '[]', risks jsonb not null default '[]', missing_data jsonb not null default '[]', suggested_action text not null,
  evidence_refs jsonb not null default '[]', input_hash text not null, output_hash text not null, response_id text, usage jsonb not null default '{}', created_at timestamptz not null default now(),
  check(available_at>=information_cutoff_at)
);
create index ai_explanations_entity_idx on public.ai_explanations(entity_type,entity_id,created_at desc);
create or replace function public.prevent_ai_explanation_mutation()returns trigger language plpgsql as $$begin raise exception'AI explanation history is immutable';end$$;
create trigger ai_explanations_immutable before update or delete on public.ai_explanations for each row execute function public.prevent_ai_explanation_mutation();
alter table public.ai_explanations enable row level security;
create policy "public read ai explanations" on public.ai_explanations for select using(true);
grant select on public.ai_explanations to anon,authenticated; grant all on public.ai_explanations to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('ai-explanations-15m','AI_EXPLANATION','forecast-scheduler-v1.5',900,240,'PAUSED',now(),' {"maxExplanationsPerRun":5,"maxOutputTokens":1400}',75,false)
on conflict(job_key) do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,updated_at=now();
