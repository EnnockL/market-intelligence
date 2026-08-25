alter table public.strategy_definitions
  drop constraint if exists strategy_definitions_setup_type_check;

alter table public.strategy_definitions
  add constraint strategy_definitions_setup_type_check
  check (setup_type in ('SESSION_SWEEP_REVERSAL', 'EMA_VWAP_MOMENTUM', 'OPENING_RANGE_BREAKOUT'));

alter table public.strategy_evaluation_trades
  add column if not exists entry_hour text not null default 'UNKNOWN',
  add column if not exists volatility_bucket text not null default 'UNKNOWN';

alter table public.strategy_segment_metrics
  drop constraint if exists strategy_segment_metrics_dimension_check;

alter table public.strategy_segment_metrics
  add constraint strategy_segment_metrics_dimension_check
  check (dimension in ('weekday', 'session', 'regime', 'side', 'entryHour', 'volatilityBucket'));

comment on column public.strategy_evaluation_trades.entry_hour is
  'Exchange-local entry hour captured point-in-time for deterministic segmentation.';

comment on column public.strategy_evaluation_trades.volatility_bucket is
  'Versioned strategy-derived volatility bucket; UNKNOWN when unavailable.';
