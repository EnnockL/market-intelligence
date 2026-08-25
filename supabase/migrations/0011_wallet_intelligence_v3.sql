create table public.crypto_liquidity_snapshots (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id), pool_address text not null,
  liquidity_usd numeric(30,2) not null check(liquidity_usd >= 0), provider text not null, selection_version text not null,
  observed_at timestamptz not null, effective_at timestamptz not null, information_available_at timestamptz not null,
  data_quality smallint not null check(data_quality between 0 and 100), raw_payload jsonb not null default '{}',
  unique(asset_id,pool_address,provider,effective_at), check(effective_at <= information_available_at)
);
create index liquidity_replay_idx on public.crypto_liquidity_snapshots(asset_id,effective_at desc,information_available_at desc);

create table public.token_risk_assessments (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id), provider text not null,
  risk_version text not null, assessed_at timestamptz not null, information_cutoff_at timestamptz not null,
  information_available_at timestamptz not null, rug_risk_score smallint check(rug_risk_score between 0 and 100),
  rug_status text not null check(rug_status in ('LOW_RISK','ELEVATED','HIGH_RISK','CONFIRMED_RUG','UNKNOWN')),
  risk_components jsonb not null default '{}', data_quality smallint not null check(data_quality between 0 and 100),
  unique(asset_id,provider,risk_version,information_cutoff_at), check(information_cutoff_at <= information_available_at)
);
create index token_risk_replay_idx on public.token_risk_assessments(asset_id,information_cutoff_at desc,information_available_at desc);

alter table public.wallet_trade_cycles
  add column entry_liquidity_usd numeric(30,2), add column exit_liquidity_usd numeric(30,2),
  add column min_liquidity_during_trade_usd numeric(30,2), add column max_liquidity_during_trade_usd numeric(30,2),
  add column liquidity_source text, add column liquidity_observed_at timestamptz,
  add column liquidity_data_quality smallint not null default 0 check(liquidity_data_quality between 0 and 100),
  add column position_to_liquidity_ratio numeric(18,10), add column execution_capacity_risk text not null default 'UNKNOWN'
    check(execution_capacity_risk in ('LOW','MEDIUM','HIGH','EXTREME','UNKNOWN')),
  add column maximum_favorable_excursion_percent numeric(18,6), add column maximum_adverse_excursion_percent numeric(18,6),
  add column post_trade_evaluation jsonb not null default '{}';

create table public.wallet_performance_points (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
  trade_cycle_id uuid not null references public.wallet_trade_cycles(id) on delete cascade, curve_version text not null,
  point_at timestamptz not null, cumulative_realized_pnl_usd numeric(30,2) not null,
  cumulative_return numeric(18,8) not null, equity_index numeric(24,10) not null,
  information_available_at timestamptz not null, unique(wallet_id,trade_cycle_id,curve_version), check(point_at <= information_available_at)
);
create index wallet_performance_replay_idx on public.wallet_performance_points(wallet_id,point_at,information_available_at);

alter table public.wallet_metric_snapshots
  add column max_drawdown_usd numeric(30,2), add column drawdown_status text not null default 'insufficient_data'
    check(drawdown_status in ('available','insufficient_data')),
  add column drawdown_start_at timestamptz, add column drawdown_bottom_at timestamptz, add column drawdown_recovered_at timestamptz,
  add column pricing_coverage smallint not null default 0, add column liquidity_coverage smallint not null default 0;

create table public.wallet_verification_evaluations (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id), policy_version text not null,
  evaluated_at timestamptz not null, data_snapshot_cutoff timestamptz not null, current_status text not null,
  eligible_status text not null check(eligible_status in ('candidate','reviewing','verified')),
  requirements_passed jsonb not null default '[]', requirements_failed jsonb not null default '[]', evidence jsonb not null default '{}',
  unique(wallet_id,policy_version,evaluated_at), check(data_snapshot_cutoff <= evaluated_at)
);
create index wallet_verification_history_idx on public.wallet_verification_evaluations(wallet_id,evaluated_at desc);

alter table public.crypto_liquidity_snapshots enable row level security;
alter table public.token_risk_assessments enable row level security;
alter table public.wallet_performance_points enable row level security;
alter table public.wallet_verification_evaluations enable row level security;
grant all privileges on public.crypto_liquidity_snapshots,public.token_risk_assessments,public.wallet_performance_points,public.wallet_verification_evaluations to service_role;

comment on table public.wallet_performance_points is 'Realized-PnL curve only; not full wallet equity.';
comment on column public.wallet_trade_cycles.post_trade_evaluation is 'Future outcome evaluation isolated from point-in-time entry_context.';
