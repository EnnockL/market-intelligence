alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check (job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl'));

alter table public.crypto_tokens alter column decimals drop not null;

create table public.crypto_market_observations (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id),
  provider text not null, observed_at timestamptz not null, provider_timestamp timestamptz,
  price_usd numeric(30,12), market_cap_usd numeric(30,2), circulating_supply numeric(38,8),
  liquidity_usd numeric(30,2), volume_24h_usd numeric(30,2), pool_address text,
  confidence smallint not null check(confidence between 0 and 100),
  completeness text not null check(completeness in ('complete','partial','unavailable')),
  raw_payload jsonb not null default '{}', ingested_at timestamptz not null default now(),
  unique(asset_id, provider, observed_at)
);
create index crypto_market_point_in_time_idx on public.crypto_market_observations(asset_id, provider, provider_timestamp desc, observed_at desc);

create table public.wallet_transaction_enrichments (
  id uuid primary key default gen_random_uuid(), wallet_transaction_id uuid not null references public.wallet_transactions(id) on delete cascade,
  provider text not null, enrichment_version text not null, status text not null check(status in ('complete','partial','incomplete')),
  token_price_usd numeric(30,12), sol_price_usd numeric(30,12), estimated_value_usd numeric(30,2),
  fee_usd numeric(30,8), priority_fee_usd numeric(30,8), liquidity_usd numeric(30,2), market_cap_usd numeric(30,2),
  price_timestamp timestamptz, known_at timestamptz not null, pricing_completeness smallint not null,
  execution_completeness smallint not null, raw_payload jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(wallet_transaction_id, provider, enrichment_version)
);
create index wallet_enrichment_status_idx on public.wallet_transaction_enrichments(status, known_at);

create table public.wallet_trade_cycles (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id), asset_id uuid not null references public.assets(id),
  cycle_number integer not null, engine_version text not null, status text not null check(status in ('open','closed','incomplete')),
  quantity numeric(38,18) not null, invested_usd numeric(30,2), cost_basis_usd numeric(30,2), average_entry_usd numeric(30,12),
  proceeds_usd numeric(30,2), realized_pnl_usd numeric(30,2), unrealized_pnl_usd numeric(30,2), return_percent numeric(18,6),
  first_entry_at timestamptz not null, final_exit_at timestamptz, holding_seconds bigint,
  pricing_completeness smallint not null, transaction_completeness smallint not null, execution_completeness smallint not null,
  data_quality smallint not null, transaction_ids jsonb not null default '[]', rebuilt_at timestamptz not null default now(),
  unique(wallet_id, asset_id, cycle_number, engine_version)
);
create index wallet_cycles_metrics_idx on public.wallet_trade_cycles(wallet_id, engine_version, final_exit_at desc);

create table public.wallet_metric_snapshots (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
  engine_version text not null, scoring_version text not null, calculated_at timestamptz not null,
  information_available_through timestamptz not null check(information_available_through <= calculated_at),
  closed_trades integer not null, verified_trades integer not null, wins integer not null, losses integer not null,
  win_rate numeric(12,8), median_return numeric(18,6), mean_return numeric(18,6), realized_pnl_usd numeric(30,2),
  best_trade_percent numeric(18,6), worst_trade_percent numeric(18,6), median_holding_seconds bigint,
  data_quality smallint not null, metrics jsonb not null default '{}', unique(wallet_id, engine_version, scoring_version, calculated_at)
);
create index wallet_metrics_point_in_time_idx on public.wallet_metric_snapshots(wallet_id, information_available_through desc);

alter table public.crypto_market_observations enable row level security;
alter table public.wallet_transaction_enrichments enable row level security;
alter table public.wallet_trade_cycles enable row level security;
alter table public.wallet_metric_snapshots enable row level security;
grant all privileges on public.crypto_market_observations, public.wallet_transaction_enrichments, public.wallet_trade_cycles, public.wallet_metric_snapshots to service_role;

comment on table public.wallet_transaction_enrichments is 'Versioned enrichment only; raw wallet_transactions remain immutable.';
comment on column public.wallet_metric_snapshots.information_available_through is 'Point-in-time cutoff preventing look-ahead bias.';
