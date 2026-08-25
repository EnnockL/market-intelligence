alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check (job_kind in ('stock_quotes', 'wallet_transactions', 'wallet_discovery'));

create table public.wallet_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'solana', address text not null, provider text not null,
  status text not null default 'candidate' check (status in ('candidate','reviewing','verified','rejected')),
  score integer not null check (score between 0 and 100),
  data_quality integer not null check (data_quality between 0 and 100),
  observed_transactions integer not null default 0, successful_transactions integer not null default 0,
  active_days numeric(12,4) not null default 0, source_addresses jsonb not null default '[]',
  reasons jsonb not null default '[]', risk_flags jsonb not null default '[]',
  first_observed_at timestamptz not null default now(), last_observed_at timestamptz not null,
  reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(chain, address)
);
create index wallet_discovery_ranking_idx on public.wallet_discovery_candidates(status, score desc, data_quality desc);
alter table public.wallet_discovery_candidates enable row level security;
grant all privileges on public.wallet_discovery_candidates to service_role;

comment on table public.wallet_discovery_candidates is
  'Unverified public wallet candidates. Rows never enable tracking or trading automatically.';
