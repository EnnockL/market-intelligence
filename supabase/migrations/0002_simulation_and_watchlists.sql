create type public.simulation_status as enum ('queued', 'running', 'completed', 'failed');
create type public.portfolio_status as enum ('active', 'paused', 'closed');

create table public.watchlists (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id, name)
);
create unique index watchlists_one_default_idx on public.watchlists(user_id) where is_default;

create table public.watchlist_items (
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  note text, created_at timestamptz not null default now(), primary key(watchlist_id, asset_id)
);

create table public.simulation_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  strategy text not null, status public.simulation_status not null default 'queued',
  initial_capital_sek numeric(24,2) not null check(initial_capital_sek > 0),
  starts_at timestamptz not null, ends_at timestamptz not null,
  information_cutoff_at timestamptz not null, assumptions jsonb not null,
  scoring_version text not null, error_message text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  check(ends_at > starts_at), check(information_cutoff_at <= starts_at)
);
create index simulation_runs_user_time_idx on public.simulation_runs(user_id, created_at desc);

create table public.simulation_trades (
  id uuid primary key default gen_random_uuid(), simulation_run_id uuid not null references public.simulation_runs(id) on delete cascade,
  signal_id uuid not null references public.signals(id), asset_id uuid not null references public.assets(id),
  side text not null check(side in ('buy','sell')), requested_at timestamptz not null, executed_at timestamptz not null,
  quantity numeric(38,18) not null check(quantity > 0), execution_price numeric(24,10) not null check(execution_price >= 0),
  gross_value_sek numeric(24,2) not null, fee_sek numeric(24,2) not null default 0,
  slippage_bps numeric not null default 0, available_liquidity_usd numeric(24,2), realized_pnl_sek numeric(24,2),
  execution_context jsonb not null default '{}'
);
create index simulation_trades_run_time_idx on public.simulation_trades(simulation_run_id, executed_at);

create table public.simulation_equity_points (
  simulation_run_id uuid not null references public.simulation_runs(id) on delete cascade,
  captured_at timestamptz not null, cash_sek numeric(24,2) not null, positions_value_sek numeric(24,2) not null,
  total_value_sek numeric(24,2) generated always as (cash_sek + positions_value_sek) stored,
  primary key(simulation_run_id, captured_at)
);

create table public.simulation_results (
  simulation_run_id uuid primary key references public.simulation_runs(id) on delete cascade,
  final_value_sek numeric(24,2) not null, return_percent numeric not null,
  trade_count integer not null, winning_trades integer not null, losing_trades integer not null,
  max_drawdown_percent numeric not null, profit_factor numeric,
  largest_win_percent numeric, largest_loss_percent numeric, calculated_at timestamptz not null default now()
);

create table public.simulation_benchmarks (
  simulation_run_id uuid not null references public.simulation_runs(id) on delete cascade,
  benchmark text not null check(benchmark in ('sp500','nasdaq','bitcoin','cash')),
  final_value_sek numeric(24,2) not null, return_percent numeric not null,
  primary key(simulation_run_id, benchmark)
);

create table public.replay_checkpoints (
  id uuid primary key default gen_random_uuid(), simulation_run_id uuid not null references public.simulation_runs(id) on delete cascade,
  replay_time timestamptz not null, information_available_through timestamptz not null,
  state jsonb not null, created_at timestamptz not null default now(),
  check(information_available_through <= replay_time), unique(simulation_run_id, replay_time)
);

create table public.paper_portfolios (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, strategy text not null, status public.portfolio_status not null default 'active',
  initial_capital_sek numeric(24,2) not null check(initial_capital_sek > 0),
  cash_sek numeric(24,2) not null, assumptions jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.paper_positions (
  id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.paper_portfolios(id) on delete cascade,
  asset_id uuid not null references public.assets(id), quantity numeric(38,18) not null,
  average_entry_price numeric(24,10) not null, opened_at timestamptz not null, closed_at timestamptz,
  unique(portfolio_id, asset_id, opened_at)
);

alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.simulation_runs enable row level security;
alter table public.simulation_trades enable row level security;
alter table public.simulation_equity_points enable row level security;
alter table public.simulation_results enable row level security;
alter table public.simulation_benchmarks enable row level security;
alter table public.replay_checkpoints enable row level security;
alter table public.paper_portfolios enable row level security;
alter table public.paper_positions enable row level security;

create policy "users manage own watchlists" on public.watchlists for all using(auth.uid() = user_id) with check(auth.uid() = user_id);
create policy "users manage own watchlist items" on public.watchlist_items for all using(exists(select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())) with check(exists(select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy "users read own simulations" on public.simulation_runs for select using(auth.uid() = user_id);
create policy "users create own simulations" on public.simulation_runs for insert with check(auth.uid() = user_id);
create policy "users read own simulation trades" on public.simulation_trades for select using(exists(select 1 from public.simulation_runs r where r.id = simulation_run_id and r.user_id = auth.uid()));
create policy "users read own equity points" on public.simulation_equity_points for select using(exists(select 1 from public.simulation_runs r where r.id = simulation_run_id and r.user_id = auth.uid()));
create policy "users read own simulation results" on public.simulation_results for select using(exists(select 1 from public.simulation_runs r where r.id = simulation_run_id and r.user_id = auth.uid()));
create policy "users read own benchmarks" on public.simulation_benchmarks for select using(exists(select 1 from public.simulation_runs r where r.id = simulation_run_id and r.user_id = auth.uid()));
create policy "users read own replay checkpoints" on public.replay_checkpoints for select using(exists(select 1 from public.simulation_runs r where r.id = simulation_run_id and r.user_id = auth.uid()));
create policy "users manage own paper portfolios" on public.paper_portfolios for all using(auth.uid() = user_id) with check(auth.uid() = user_id);
create policy "users read own paper positions" on public.paper_positions for select using(exists(select 1 from public.paper_portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

