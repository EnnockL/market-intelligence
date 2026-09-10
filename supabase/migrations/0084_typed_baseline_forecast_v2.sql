-- V1 forecasts and their source references remain immutable. V2 records stock
-- candle evidence separately from crypto observation evidence.
alter table public.baseline_cohort_members
  alter column source_observation_id drop not null,
  add column source_candle_id uuid references public.market_candles(id),
  add constraint baseline_cohort_one_source check (
    (source_observation_id is not null)::int + (source_candle_id is not null)::int = 1
  ),
  add constraint baseline_cohort_forecast_candle_unique unique (forecast_id, source_candle_id);

create index if not exists forecasts_baseline_v2_source_forecast_idx
  on public.forecasts ((agent_inputs ->> 'sourceForecastId'))
  where forecast_version = 'historical-cohort-baseline-v2';

create view public.baseline_forecast_pending_targets_v2
with (security_invoker = true)
as
select source.*, asset.kind as asset_kind
from public.forecasts source
join public.assets asset on asset.id = source.asset_id
where source.forecast_method = 'INSUFFICIENT_DATA'
  and source.forecast_version = 'forecast-infrastructure-v1'
  and not exists (
    select 1 from public.forecasts baseline
    where baseline.forecast_version = 'historical-cohort-baseline-v2'
      and baseline.agent_inputs ->> 'sourceForecastId' = source.id::text
  );

revoke all on public.baseline_forecast_pending_targets_v2 from public, anon, authenticated;
grant select on public.baseline_forecast_pending_targets_v2 to service_role;
