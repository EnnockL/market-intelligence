alter table public.wallets add column if not exists metadata jsonb not null default '{}';

create type public.ingestion_status as enum ('running', 'succeeded', 'failed');
create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(), job_kind text not null check(job_kind in ('stock_quotes','wallet_transactions')),
  provider text not null, status public.ingestion_status not null, records_processed integer not null default 0,
  error_code text, error_message text, started_at timestamptz not null default now(), finished_at timestamptz
);
create index ingestion_runs_latest_idx on public.ingestion_runs(job_kind, started_at desc);

create table public.provider_errors (
  id uuid primary key default gen_random_uuid(), ingestion_run_id uuid references public.ingestion_runs(id) on delete set null,
  provider text not null, error_code text not null, message text not null, retryable boolean not null,
  http_status integer, context jsonb not null default '{}', occurred_at timestamptz not null default now()
);

create or replace function public.update_wallet_sync_cursor(target_wallet_id uuid, new_signature text)
returns void language sql security definer set search_path = public as $$
  update public.wallets set metadata = metadata || jsonb_build_object('last_signature', new_signature, 'last_synced_at', now()) where id = target_wallet_id;
$$;
revoke all on function public.update_wallet_sync_cursor(uuid, text) from public, anon, authenticated;
grant execute on function public.update_wallet_sync_cursor(uuid, text) to service_role;

alter table public.ingestion_runs enable row level security;
alter table public.provider_errors enable row level security;
