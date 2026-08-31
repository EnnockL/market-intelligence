create index if not exists forecasts_baseline_source_forecast_idx
  on public.forecasts ((agent_inputs ->> 'sourceForecastId'))
  where forecast_version = 'historical-cohort-baseline-v1';

create or replace view public.baseline_forecast_pending_targets
with (security_invoker = true)
as
select source.*
from public.forecasts source
where source.forecast_method = 'INSUFFICIENT_DATA'
  and source.forecast_version = 'forecast-infrastructure-v1'
  and not exists (
    select 1
    from public.forecasts baseline
    where baseline.forecast_version = 'historical-cohort-baseline-v1'
      and baseline.agent_inputs ->> 'sourceForecastId' = source.id::text
  );

grant select on public.baseline_forecast_pending_targets to service_role;
