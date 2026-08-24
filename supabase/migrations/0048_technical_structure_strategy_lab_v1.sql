create table public.market_candles(
  id uuid primary key default gen_random_uuid(), candle_key text not null unique, asset_id uuid not null references public.assets(id),
  provider text not null, timeframe text not null, opened_at timestamptz not null, closed_at timestamptz not null, observed_at timestamptz not null, available_at timestamptz not null,
  open numeric not null, high numeric not null, low numeric not null, close numeric not null, volume numeric, data_quality integer not null check(data_quality between 0 and 100), raw_payload jsonb not null default '{}', created_at timestamptz not null default now(),
  check(opened_at<closed_at), check(closed_at<=observed_at and observed_at<=available_at), check(high>=greatest(open,close,low)), check(low<=least(open,close,high)), unique(asset_id,provider,timeframe,opened_at)
);
create index market_candles_replay_idx on public.market_candles(asset_id,timeframe,closed_at,available_at);

create table public.technical_structure_snapshots(
  id uuid primary key default gen_random_uuid(), snapshot_key text not null unique, version text not null, asset_id uuid not null references public.assets(id), timeframe text not null,
  analysis_cutoff_at timestamptz not null, available_at timestamptz not null, status text not null check(status in('AVAILABLE','INSUFFICIENT_DATA')), trend_state text not null,
  structure jsonb not null, evidence_refs jsonb not null, data_quality integer not null, analysis_hash text not null, created_at timestamptz not null default now(), check(available_at<=analysis_cutoff_at)
);
create table public.market_time_contexts(
  id uuid primary key default gen_random_uuid(), context_key text not null unique, version text not null, asset_id uuid references public.assets(id), cutoff_at timestamptz not null, available_at timestamptz not null,
  exchange_timezone text not null, weekday text not null, utc_time time not null, local_exchange_time time not null, market_session text not null, session_phase text not null,
  minutes_since_open integer, minutes_to_close integer, flags jsonb not null, context_hash text not null, created_at timestamptz not null default now(), check(available_at<=cutoff_at)
);

create table public.strategy_definitions(
  id uuid primary key default gen_random_uuid(), strategy_key text not null, version integer not null, name text not null, market text not null, timeframe text not null,
  setup_type text not null check(setup_type in('SESSION_SWEEP_REVERSAL','EMA_VWAP_MOMENTUM')), definition jsonb not null, definition_hash text not null unique,
  status text not null default 'ACTIVE' check(status in('ACTIVE','DEPRECATED')), effective_at timestamptz not null, available_at timestamptz not null, created_at timestamptz not null default now(),
  check(effective_at<=available_at), unique(strategy_key,version)
);
create table public.strategy_evaluation_runs(
  id uuid primary key default gen_random_uuid(), run_key text not null unique, lab_version text not null, strategy_definition_id uuid not null references public.strategy_definitions(id), asset_id uuid not null references public.assets(id),
  information_cutoff_at timestamptz not null, available_at timestamptz not null, status text not null check(status in('AVAILABLE','INSUFFICIENT_DATA')), reason text,
  input_hash text not null unique, candle_count integer not null, setup_count integer not null, trade_count integer not null, sample_size integer not null, minimum_sample_size integer not null,
  metrics jsonb not null, result_hash text not null, created_at timestamptz not null default now(), check(available_at<=information_cutoff_at)
);
create table public.strategy_evaluation_trades(
  id uuid primary key default gen_random_uuid(), evaluation_run_id uuid not null references public.strategy_evaluation_runs(id), trade_key text not null, side text not null check(side in('LONG','SHORT')),
  setup_at timestamptz not null, entered_at timestamptz not null, exited_at timestamptz not null, entry numeric not null, stop numeric not null, target numeric not null, exit numeric not null,
  outcome text not null check(outcome in('WIN','LOSS','TIME_EXIT')), r_multiple numeric not null, mfe_r numeric not null, mae_r numeric not null, hold_minutes numeric not null,
  evidence_refs jsonb not null, session text not null, weekday text not null, regime text not null, created_at timestamptz not null default now(), unique(evaluation_run_id,trade_key)
);
create table public.strategy_segment_metrics(
  id uuid primary key default gen_random_uuid(), evaluation_run_id uuid not null references public.strategy_evaluation_runs(id), dimension text not null check(dimension in('weekday','session','regime')), value text not null,
  sample_size integer not null, status text not null check(status in('AVAILABLE','INSUFFICIENT_DATA')), win_rate numeric, average_r numeric, created_at timestamptz not null default now(), unique(evaluation_run_id,dimension,value)
);

create or replace function public.prevent_strategy_lab_mutation() returns trigger language plpgsql as $$ begin raise exception 'Strategy Lab history is immutable'; end $$;
create trigger market_candles_immutable before update or delete on public.market_candles for each row execute function public.prevent_strategy_lab_mutation();
create trigger technical_structure_snapshots_immutable before update or delete on public.technical_structure_snapshots for each row execute function public.prevent_strategy_lab_mutation();
create trigger market_time_contexts_immutable before update or delete on public.market_time_contexts for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_definitions_immutable before update or delete on public.strategy_definitions for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_evaluation_runs_immutable before update or delete on public.strategy_evaluation_runs for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_evaluation_trades_immutable before update or delete on public.strategy_evaluation_trades for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_segment_metrics_immutable before update or delete on public.strategy_segment_metrics for each row execute function public.prevent_strategy_lab_mutation();

alter table public.market_candles enable row level security; alter table public.technical_structure_snapshots enable row level security; alter table public.market_time_contexts enable row level security;
alter table public.strategy_definitions enable row level security; alter table public.strategy_evaluation_runs enable row level security; alter table public.strategy_evaluation_trades enable row level security; alter table public.strategy_segment_metrics enable row level security;
create policy "public read market candles" on public.market_candles for select using(true); create policy "public read technical structures" on public.technical_structure_snapshots for select using(true);
create policy "public read market time contexts" on public.market_time_contexts for select using(true); create policy "public read strategy definitions" on public.strategy_definitions for select using(true);
create policy "public read strategy runs" on public.strategy_evaluation_runs for select using(true); create policy "public read strategy trades" on public.strategy_evaluation_trades for select using(true); create policy "public read strategy segments" on public.strategy_segment_metrics for select using(true);
grant select on public.market_candles,public.technical_structure_snapshots,public.market_time_contexts,public.strategy_definitions,public.strategy_evaluation_runs,public.strategy_evaluation_trades,public.strategy_segment_metrics to anon,authenticated;
grant all on public.market_candles,public.technical_structure_snapshots,public.market_time_contexts,public.strategy_definitions,public.strategy_evaluation_runs,public.strategy_evaluation_trades,public.strategy_segment_metrics to service_role;
