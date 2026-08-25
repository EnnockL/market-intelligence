create table public.token_risk_observations (
  id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.assets(id),
  provider text not null, model_version text not null, classification text not null
    check(classification in ('clear','watch','rug_confirmed','unknown')),
  confidence smallint not null check(confidence between 0 and 100), evidence jsonb not null default '{}',
  observed_at timestamptz not null, known_at timestamptz not null,
  unique(asset_id, provider, model_version, observed_at), check(observed_at <= known_at)
);
create index token_risk_point_in_time_idx on public.token_risk_observations(asset_id, known_at desc, observed_at desc);
alter table public.token_risk_observations enable row level security;
grant all privileges on public.token_risk_observations to service_role;

alter table public.wallet_metric_snapshots
  add column max_drawdown numeric(12,8),
  add column rug_exposure_rate numeric(12,8),
  add column rug_assessed_trades integer not null default 0,
  add column risk_data_quality smallint not null default 0 check(risk_data_quality between 0 and 100);

comment on table public.token_risk_observations is 'Immutable, provider-neutral point-in-time token risk evidence. Unknown is never treated as safe.';
comment on column public.wallet_metric_snapshots.max_drawdown is 'Compounded peak-to-trough drawdown over verified closed trade returns; fraction from 0 to 1.';
