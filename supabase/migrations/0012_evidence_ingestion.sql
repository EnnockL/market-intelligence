alter table public.crypto_liquidity_snapshots alter column pool_address drop not null;
alter table public.crypto_liquidity_snapshots add column snapshot_key text;
update public.crypto_liquidity_snapshots set snapshot_key=id::text where snapshot_key is null;
alter table public.crypto_liquidity_snapshots alter column snapshot_key set not null;
alter table public.crypto_liquidity_snapshots add constraint crypto_liquidity_snapshot_key_unique unique(snapshot_key);

create table public.token_risk_components (
  id uuid primary key default gen_random_uuid(), assessment_id uuid not null references public.token_risk_assessments(id) on delete cascade,
  component_key text not null, component_value jsonb, component_status text not null check(component_status in ('safe','warning','critical','unknown')),
  observed_at timestamptz not null, information_available_at timestamptz not null, source text not null,
  unique(assessment_id,component_key), check(observed_at <= information_available_at)
);
create index token_risk_components_replay_idx on public.token_risk_components(component_key,information_available_at);
alter table public.token_risk_components enable row level security;
grant all privileges on public.token_risk_components to service_role;

create table public.wallet_verification_progress (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id), policy_version text not null,
  calculated_at timestamptz not null, eligible_status text not null check(eligible_status in ('candidate','reviewing','verified')),
  verified_trades integer not null, required_verified_trades integer not null, history_days integer not null, required_history_days integer not null,
  liquidity_coverage smallint not null, required_liquidity_coverage smallint not null, risk_coverage smallint not null, required_risk_coverage smallint not null,
  data_quality smallint not null, required_data_quality smallint not null, pricing_coverage smallint not null, required_pricing_coverage smallint not null,
  drawdown_available boolean not null, blockers jsonb not null default '[]', progress jsonb not null default '{}',
  unique(wallet_id,policy_version,calculated_at)
);
create index wallet_verification_progress_latest_idx on public.wallet_verification_progress(wallet_id,calculated_at desc);
alter table public.wallet_verification_progress enable row level security;
grant all privileges on public.wallet_verification_progress to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check(job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence'));

create or replace function public.update_wallet_backfill_cursor(target_wallet_id uuid, before_signature text, is_complete boolean)
returns void language sql security definer set search_path = public as $$
  update public.wallets set metadata = metadata || jsonb_build_object('backfill_before',before_signature,'backfill_complete',is_complete,'backfill_synced_at',now()) where id=target_wallet_id;
$$;
revoke all on function public.update_wallet_backfill_cursor(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.update_wallet_backfill_cursor(uuid,text,boolean) to service_role;
