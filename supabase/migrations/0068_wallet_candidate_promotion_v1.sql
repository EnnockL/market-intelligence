alter table public.wallet_discovery_candidates drop constraint if exists wallet_discovery_candidates_status_check;
alter table public.wallet_discovery_candidates add constraint wallet_discovery_candidates_status_check check(status in('candidate','tracked','reviewing','verified','rejected'));
create or replace function public.prevent_wallet_candidate_status_regression()returns trigger language plpgsql as $$begin
  if old.status='verified' and new.status<>'verified' then new.status=old.status;
  elsif old.status='reviewing' and new.status in('candidate','tracked') then new.status=old.status;
  elsif old.status='tracked' and new.status='candidate' then new.status=old.status;
  elsif old.status='rejected' and new.status<>'rejected' then new.status=old.status;
  end if;
  return new;
end$$;
create trigger wallet_candidate_status_no_regression before update on public.wallet_discovery_candidates for each row execute function public.prevent_wallet_candidate_status_regression();

create table public.wallet_promotion_evaluations(
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  candidate_id uuid not null references public.wallet_discovery_candidates(id),
  wallet_id uuid references public.wallets(id),
  verification_evaluation_id uuid references public.wallet_verification_evaluations(id),
  policy_version text not null,
  previous_state text not null,
  decided_state text not null check(decided_state in('candidate','tracked','reviewing','verified','rejected')),
  requirements jsonb not null,
  blockers jsonb not null,
  information_cutoff_at timestamptz not null,
  available_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(information_cutoff_at<=available_at)
);
create index wallet_promotion_candidate_timeline_idx on public.wallet_promotion_evaluations(candidate_id,available_at desc);
create or replace function public.prevent_wallet_promotion_mutation()returns trigger language plpgsql as $$begin raise exception'Wallet promotion evaluations are immutable';end$$;
create trigger wallet_promotion_evaluations_immutable before update or delete on public.wallet_promotion_evaluations for each row execute function public.prevent_wallet_promotion_mutation();
alter table public.wallet_promotion_evaluations enable row level security;
grant all privileges on public.wallet_promotion_evaluations to service_role;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'WALLET_PROMOTION','POOL_DISCOVERY','DATA_GAP_CLOSURE','QUALIFICATION','TRADE_PROPOSAL_PRODUCER','EXECUTION_PIPELINE','AI_EXPLANATION','CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority,enabled)
values('wallet-promotion-15m','WALLET_PROMOTION','forecast-scheduler-v1.9',900,120,'HEALTHY',now(),'{}',6,true)
on conflict(job_key)do update set job_type=excluded.job_type,scheduler_version=excluded.scheduler_version,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,priority=excluded.priority,enabled=excluded.enabled,updated_at=now();
