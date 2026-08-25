create table public.strategy_performance_snapshots(
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  performance_version text not null,
  strategy_definition_id uuid not null references public.strategy_definitions(id),
  evaluation_run_id uuid not null references public.strategy_evaluation_runs(id),
  asset_id uuid not null references public.assets(id),
  evaluation_window_start timestamptz not null,
  evaluation_window_end timestamptz not null,
  information_cutoff_at timestamptz not null,
  available_at timestamptz not null,
  dataset_hash text not null,
  market text not null,
  asset_class text not null,
  timeframe text not null,
  session text not null,
  regime text not null,
  dataset_split text not null check(dataset_split in ('TRAIN','VALIDATION','OUT_OF_SAMPLE')),
  status text not null check(status in ('AVAILABLE','INSUFFICIENT_DATA')),
  reason text,
  sample_size integer not null,
  setup_count integer not null,
  trade_count integer not null,
  data_quality integer check(data_quality between 0 and 100),
  metrics jsonb not null,
  segments jsonb not null,
  result_hash text not null,
  created_at timestamptz not null default now(),
  check(evaluation_window_start <= evaluation_window_end),
  check(evaluation_window_end <= information_cutoff_at),
  check(available_at <= information_cutoff_at),
  unique(strategy_definition_id,evaluation_run_id,evaluation_window_start,evaluation_window_end,dataset_split)
);
create index strategy_performance_context_idx on public.strategy_performance_snapshots(asset_id,timeframe,session,regime,information_cutoff_at);

create table public.strategy_selector_runs(
  id uuid primary key default gen_random_uuid(),
  selector_key text not null unique,
  selector_version text not null,
  asset_id uuid not null references public.assets(id),
  timeframe text not null,
  session text not null,
  regime text not null,
  volatility_bucket text not null,
  liquidity_bucket text not null,
  information_cutoff_at timestamptz not null,
  available_at timestamptz not null,
  status text not null check(status in ('RANKED','NO_STRATEGY_ELIGIBLE')),
  input_snapshot_keys jsonb not null,
  ranked_strategies jsonb not null,
  selected_strategy jsonb,
  result_hash text not null,
  created_at timestamptz not null default now(),
  check(available_at <= information_cutoff_at)
);

create trigger strategy_performance_snapshots_immutable before update or delete on public.strategy_performance_snapshots for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_selector_runs_immutable before update or delete on public.strategy_selector_runs for each row execute function public.prevent_strategy_lab_mutation();
alter table public.strategy_performance_snapshots enable row level security;
alter table public.strategy_selector_runs enable row level security;
create policy "public read strategy performance snapshots" on public.strategy_performance_snapshots for select using(true);
create policy "public read strategy selector runs" on public.strategy_selector_runs for select using(true);
grant select on public.strategy_performance_snapshots,public.strategy_selector_runs to anon,authenticated;
grant all on public.strategy_performance_snapshots,public.strategy_selector_runs to service_role;
