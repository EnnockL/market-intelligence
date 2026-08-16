create extension if not exists pgcrypto;

create type public.asset_kind as enum ('stock', 'crypto');
create type public.signal_direction as enum ('bullish', 'bearish', 'neutral');
create type public.event_source as enum ('market', 'wallet', 'news', 'filing', 'company', 'social', 'system');

create table public.assets (
  id uuid primary key default gen_random_uuid(), kind public.asset_kind not null,
  symbol text not null, name text not null, external_id text,
  is_active boolean not null default true, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (kind, symbol)
);
create index assets_active_kind_idx on public.assets (kind, is_active);

create table public.stocks (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  exchange text not null, currency text not null default 'USD', cik text, sector text, industry text
);
create table public.crypto_tokens (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  chain text not null default 'solana', mint_address text not null unique,
  decimals smallint not null check (decimals between 0 and 18), first_seen_at timestamptz,
  mint_authority text, freeze_authority text
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(), chain text not null default 'solana', address text not null,
  label text, is_tracked boolean not null default true, first_seen_at timestamptz,
  created_at timestamptz not null default now(), unique(chain, address)
);
create index wallets_tracked_idx on public.wallets (is_tracked) where is_tracked;

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
  asset_id uuid references public.assets(id), transaction_hash text not null, instruction_index integer not null default 0,
  side text check (side in ('buy','sell','transfer','other')), quantity numeric(38,18), price_usd numeric(24,10), value_usd numeric(24,2),
  block_number bigint, occurred_at timestamptz not null, raw_payload jsonb not null default '{}', ingested_at timestamptz not null default now(),
  unique(transaction_hash, instruction_index, wallet_id)
);
create index wallet_transactions_timeline_idx on public.wallet_transactions (wallet_id, occurred_at desc);
create index wallet_transactions_asset_idx on public.wallet_transactions (asset_id, occurred_at desc);

create table public.wallet_scores (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
  score smallint not null check(score between 0 and 100), data_quality smallint not null check(data_quality between 0 and 100),
  scoring_version text not null, components jsonb not null, calculated_at timestamptz not null default now(),
  unique(wallet_id, scoring_version, calculated_at)
);
create index wallet_scores_latest_idx on public.wallet_scores (wallet_id, calculated_at desc);

create table public.market_prices (
  asset_id uuid not null references public.assets(id), provider text not null, interval text not null,
  captured_at timestamptz not null, open numeric(24,10), high numeric(24,10), low numeric(24,10), close numeric(24,10) not null,
  volume numeric(30,8), market_cap_usd numeric(24,2), source_event_id text,
  primary key(asset_id, provider, interval, captured_at)
);
create index market_prices_asset_time_idx on public.market_prices (asset_id, captured_at desc);

create table public.asset_events (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id),
  source public.event_source not null, source_id text not null, event_type text not null, title text not null,
  summary text, occurred_at timestamptz not null, payload jsonb not null default '{}', ingested_at timestamptz not null default now(),
  unique(source, source_id)
);
create index asset_events_timeline_idx on public.asset_events (asset_id, occurred_at desc);

create table public.signals (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id),
  direction public.signal_direction not null, opportunity_score smallint not null check(opportunity_score between 0 and 100),
  risk_score smallint not null check(risk_score between 0 and 100), confidence smallint check(confidence between 0 and 100),
  scoring_version text not null, thesis text, observed_price_usd numeric(24,10), generated_at timestamptz not null default now(),
  expires_at timestamptz, status text not null default 'active' check(status in ('active','expired','invalidated'))
);
create index signals_ranked_idx on public.signals (status, opportunity_score desc, generated_at desc);

create table public.signal_components (
  id uuid primary key default gen_random_uuid(), signal_id uuid not null references public.signals(id) on delete cascade,
  component_key text not null, raw_value numeric, normalized_score numeric not null check(normalized_score between 0 and 100),
  weight numeric not null check(weight between 0 and 1), contribution numeric not null,
  evidence jsonb not null default '[]', unique(signal_id, component_key)
);

alter table public.assets enable row level security;
alter table public.stocks enable row level security;
alter table public.crypto_tokens enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wallet_scores enable row level security;
alter table public.market_prices enable row level security;
alter table public.asset_events enable row level security;
alter table public.signals enable row level security;
alter table public.signal_components enable row level security;

create policy "public read active assets" on public.assets for select using (is_active);
create policy "public read market prices" on public.market_prices for select using (true);
create policy "public read asset events" on public.asset_events for select using (true);
create policy "public read active signals" on public.signals for select using (status = 'active');
create policy "public read signal components" on public.signal_components for select using (true);

