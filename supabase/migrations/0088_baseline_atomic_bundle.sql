-- A forecast, its input snapshot, cohort and publication event commit together.
-- Immutable partial legacy v2 rows are NOT silently repaired or marked complete.
create table public.baseline_forecast_bundles (
  forecast_id uuid primary key references public.forecasts(id),
  forecast_key text not null unique,
  bundle_hash text not null,
  committed_at timestamptz not null default now()
);
alter table public.baseline_forecast_bundles enable row level security;
revoke all on public.baseline_forecast_bundles from public, anon, authenticated;
grant all on public.baseline_forecast_bundles to service_role;
create trigger baseline_forecast_bundles_immutable before update or delete on public.baseline_forecast_bundles
  for each row execute function public.prevent_baseline_forecast_mutation();

create or replace function public.persist_baseline_forecast_bundle_v2(
  p_forecast jsonb, p_snapshot jsonb, p_members jsonb, p_event jsonb, p_bundle_hash text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  f public.forecasts; s public.baseline_feature_snapshots; m public.baseline_cohort_members;
  e public.event_outbox; existing public.forecasts; member jsonb; stored_hash text;
  source public.forecasts;
begin
  f := jsonb_populate_record(null::public.forecasts, p_forecast);
  s := jsonb_populate_record(null::public.baseline_feature_snapshots, p_snapshot);
  e := jsonb_populate_record(null::public.event_outbox, p_event);
  if f.id is null or f.forecast_key is null or nullif(p_bundle_hash,'') is null
    or f.forecast_version is distinct from 'historical-cohort-baseline-v2'
    or f.model_version is distinct from 'historical-cohort-baseline-v2'
    or f.feature_set_version is distinct from 'typed-market-features-v2'
    or jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'BASELINE_BUNDLE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baseline-bundle:' || f.forecast_key, 0));
  select * into existing from public.forecasts where forecast_key = f.forecast_key;
  if found then
    select bundle_hash into stored_hash from public.baseline_forecast_bundles where forecast_id = existing.id;
    if stored_hash is null then raise exception 'BASELINE_LEGACY_PARTIAL_REQUIRES_REVIEW'; end if;
    if stored_hash is distinct from p_bundle_hash then raise exception 'BASELINE_BUNDLE_IDENTITY_CONFLICT'; end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'reused',true);
  end if;
  select * into source from public.forecasts where id = (f.agent_inputs->>'sourceForecastId')::uuid;
  if not found or source.forecast_version <> 'forecast-infrastructure-v1'
    or source.forecast_method <> 'INSUFFICIENT_DATA'
    or source.asset_id is distinct from f.asset_id or source.horizon is distinct from f.horizon
    or source.information_cutoff_at is distinct from f.information_cutoff_at
    or source.available_at > f.available_at then
    raise exception 'BASELINE_SOURCE_MISMATCH';
  end if;
  if s.forecast_id is distinct from f.id or s.asset_id is distinct from f.asset_id
    or s.feature_version is distinct from f.feature_set_version
    or s.information_cutoff_at is distinct from f.information_cutoff_at
    or s.available_at is distinct from f.available_at
    or jsonb_array_length(p_members) is distinct from (f.agent_inputs->>'sampleSize')::integer
    or e.entity_id is distinct from f.id::text or e.asset_id is distinct from f.asset_id
    or e.event_type is distinct from 'forecast.baseline_created' or e.entity_type is distinct from 'forecast'
    or e.provider is distinct from 'baseline-forecast'
    or e.source_reference is distinct from 'baseline:' || f.forecast_key
    or e.payload->>'status' is distinct from f.status
    or e.payload->>'modelVersion' is distinct from f.model_version
    or e.available_at is distinct from f.available_at then
    raise exception 'BASELINE_BUNDLE_COMPONENT_MISMATCH';
  end if;
  insert into public.forecasts (
    id,forecast_key,asset_id,opportunity_id,candidate_id,catalyst_id,forecast_version,forecast_method,model_version,
    feature_set_version,training_cutoff_at,information_cutoff_at,available_at,horizon,status,reason,
    expected_return,lower_bound,upper_bound,probability_positive,probability_2x,probability_5x,probability_10x,
    confidence,data_quality,evidence_refs,agent_inputs,market_regime
  ) values (
    f.id,f.forecast_key,f.asset_id,f.opportunity_id,f.candidate_id,f.catalyst_id,f.forecast_version,f.forecast_method,f.model_version,
    f.feature_set_version,f.training_cutoff_at,f.information_cutoff_at,f.available_at,f.horizon,f.status,f.reason,
    f.expected_return,f.lower_bound,f.upper_bound,f.probability_positive,f.probability_2x,f.probability_5x,f.probability_10x,
    f.confidence,f.data_quality,f.evidence_refs,f.agent_inputs,f.market_regime
  );
  insert into public.baseline_feature_snapshots (
    snapshot_key,forecast_id,asset_id,feature_version,information_cutoff_at,available_at,
    price_momentum_5m,volume_multiple_5m,liquidity_usd,market_cap_usd,data_quality,feature_payload,feature_hash
  ) values (
    s.snapshot_key,s.forecast_id,s.asset_id,s.feature_version,s.information_cutoff_at,s.available_at,
    s.price_momentum_5m,s.volume_multiple_5m,s.liquidity_usd,s.market_cap_usd,s.data_quality,s.feature_payload,s.feature_hash
  );
  for member in select value from jsonb_array_elements(p_members) loop
    m := jsonb_populate_record(null::public.baseline_cohort_members, member);
    if m.forecast_id is distinct from f.id or m.anchor_at is null or m.outcome_at is null
      or m.available_at is null or m.anchor_at >= m.outcome_at or m.outcome_at > f.information_cutoff_at
      or m.available_at > f.information_cutoff_at then raise exception 'BASELINE_COHORT_CUTOFF_VIOLATION'; end if;
    if m.source_candle_id is not null and not exists (
      select 1 from public.market_candles c where c.id=m.source_candle_id and c.asset_id=f.asset_id
        and c.timeframe='5m' and c.closed_at=m.anchor_at and c.available_at<=m.available_at
    ) then raise exception 'BASELINE_CANDLE_SOURCE_MISMATCH'; end if;
    if m.source_observation_id is not null and not exists (
      select 1 from public.crypto_market_observations o where o.id=m.source_observation_id and o.asset_id=f.asset_id
        and o.observed_at=m.anchor_at and o.ingested_at<=m.available_at
    ) then raise exception 'BASELINE_OBSERVATION_SOURCE_MISMATCH'; end if;
    insert into public.baseline_cohort_members (
      forecast_id,source_observation_id,source_candle_id,anchor_at,outcome_at,return_pct,feature_distance,available_at,member_hash
    ) values (m.forecast_id,m.source_observation_id,m.source_candle_id,m.anchor_at,m.outcome_at,m.return_pct,m.feature_distance,m.available_at,m.member_hash);
  end loop;
  insert into public.event_outbox (
    event_id,schema_version,event_type,entity_type,entity_id,asset_id,occurred_at,observed_at,available_at,
    provider,source_reference,data_quality,confidence,payload,payload_hash,correlation_id,causation_id
  ) values (
    e.event_id,e.schema_version,e.event_type,e.entity_type,e.entity_id,e.asset_id,e.occurred_at,e.observed_at,e.available_at,
    e.provider,e.source_reference,e.data_quality,e.confidence,e.payload,e.payload_hash,e.correlation_id,e.causation_id
  );
  insert into public.baseline_forecast_bundles(forecast_id,forecast_key,bundle_hash) values(f.id,f.forecast_key,p_bundle_hash);
  return jsonb_build_object('id',f.id,'status',f.status,'reused',false);
end $$;
revoke all on function public.persist_baseline_forecast_bundle_v2(jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_baseline_forecast_bundle_v2(jsonb,jsonb,jsonb,jsonb,text) to service_role;

create or replace view public.baseline_forecast_pending_targets_v2 with (security_invoker=true) as
select source.*, asset.kind as asset_kind from public.forecasts source join public.assets asset on asset.id=source.asset_id
where source.forecast_method='INSUFFICIENT_DATA' and source.forecast_version='forecast-infrastructure-v1'
and not exists (
  select 1 from public.forecasts baseline join public.baseline_forecast_bundles bundle on bundle.forecast_id=baseline.id
  where baseline.forecast_version='historical-cohort-baseline-v2' and baseline.agent_inputs->>'sourceForecastId'=source.id::text
);
