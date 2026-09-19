-- Bound market regime reads and delivery registration as production history grows.
create or replace function public.market_regime_observation_pairs_for_assets(
  p_asset_class text,
  p_cutoff timestamptz,
  p_lookback_seconds integer,
  p_asset_ids uuid[]
)
returns table(
  asset_id uuid,
  current_price numeric,
  baseline_price numeric,
  current_observed_at timestamptz,
  baseline_observed_at timestamptz,
  current_evidence_ref text,
  baseline_evidence_ref text
)
language plpgsql
security definer
stable
set search_path=public
as $$
begin
  if p_asset_ids is null or cardinality(p_asset_ids)>500 then raise exception 'At most 500 assets per batch'; end if;
  if p_asset_class not in ('stock','crypto') then raise exception 'Unsupported asset class'; end if;
  if p_lookback_seconds < 1 then raise exception 'Lookback must be positive'; end if;

  if p_asset_class='crypto' then
    return query
    select a.id,c.price_usd,b.price_usd,c.observed_at,b.observed_at,c.id::text,b.id::text
    from assets a
    cross join lateral(
      select o.id,o.provider,o.price_usd,o.observed_at from crypto_market_observations o
      where o.asset_id=a.id and o.price_usd>0 and o.observed_at<=p_cutoff and o.ingested_at<=p_cutoff
      order by o.observed_at desc,o.id desc limit 1
    )c
    cross join lateral(
      select o.id,o.price_usd,o.observed_at from crypto_market_observations o
      where o.asset_id=a.id and o.provider=c.provider and o.price_usd>0
        and o.observed_at<=p_cutoff-make_interval(secs=>p_lookback_seconds) and o.ingested_at<=p_cutoff
      order by o.observed_at desc,o.id desc limit 1
    )b
    where a.kind='crypto' and a.is_active=true and a.id=any(p_asset_ids)
    order by a.id;
  else
    return query
    select a.id,c.close,b.close,c.captured_at,b.captured_at,
      coalesce(c.source_event_id,c.asset_id::text||':'||c.provider||':'||c.captured_at::text),
      coalesce(b.source_event_id,b.asset_id::text||':'||b.provider||':'||b.captured_at::text)
    from assets a
    cross join lateral(
      select p.asset_id,p.provider,p.close,p.captured_at,p.source_event_id from market_prices p
      where p.asset_id=a.id and p.close>0 and p.captured_at<=p_cutoff
      order by p.captured_at desc,p.provider,p.interval limit 1
    )c
    cross join lateral(
      select p.asset_id,p.provider,p.close,p.captured_at,p.source_event_id from market_prices p
      where p.asset_id=a.id and p.provider=c.provider and p.close>0
        and p.captured_at<=p_cutoff-make_interval(secs=>p_lookback_seconds)
      order by p.captured_at desc,p.interval limit 1
    )b
    where a.kind='stock' and a.is_active=true and a.id=any(p_asset_ids)
    order by a.id;
  end if;
end$$;

revoke all on function public.market_regime_observation_pairs_for_assets(text,timestamptz,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.market_regime_observation_pairs_for_assets(text,timestamptz,integer,uuid[]) to service_role;

create or replace function public.claim_outbox_events_for_consumer(p_consumer_name text,p_event_types text[],p_worker_id text,p_limit integer default 50,p_lock_timeout_seconds integer default 60)
returns table(event_id text,schema_version integer,event_type text,entity_type text,entity_id text,asset_id uuid,occurred_at timestamptz,
  observed_at timestamptz,available_at timestamptz,provider text,source_reference text,data_quality smallint,confidence smallint,payload jsonb,
  payload_hash text,correlation_id text,causation_id text,attempts integer,locked_at timestamptz,locked_by text)
language plpgsql security definer set search_path=public as $$
begin
  if length(trim(p_consumer_name))=0 or length(trim(p_worker_id))=0 then raise exception 'consumer and worker ids are required'; end if;
  insert into public.event_outbox_deliveries(consumer_name,event_id)
    select p_consumer_name,event.event_id from public.event_outbox event
    where event.event_type=any(p_event_types) and event.available_at<=now()
      and not exists(select 1 from public.event_outbox_deliveries existing where existing.consumer_name=p_consumer_name and existing.event_id=event.event_id)
    order by event.available_at,event.event_id
    limit least(greatest(p_limit,1),500) on conflict do nothing;
  update public.event_outbox_deliveries delivery set status='processing',attempts=delivery.attempts+1,locked_at=now(),locked_by=p_worker_id,last_error=null
  where (delivery.consumer_name,delivery.event_id) in (
    select candidate.consumer_name,candidate.event_id from public.event_outbox_deliveries candidate join public.event_outbox event on event.event_id=candidate.event_id
    where candidate.consumer_name=p_consumer_name and event.event_type=any(p_event_types) and event.available_at<=now() and ((candidate.status in ('pending','failed') and candidate.next_attempt_at<=now()) or
      (candidate.status='processing' and candidate.locked_at<now()-make_interval(secs=>greatest(1,p_lock_timeout_seconds))))
    order by event.available_at,event.event_id limit least(greatest(p_limit,1),500) for update of candidate skip locked
  );
  return query select event.event_id,event.schema_version,event.event_type,event.entity_type,event.entity_id,event.asset_id,event.occurred_at,event.observed_at,
    event.available_at,event.provider,event.source_reference,event.data_quality,event.confidence,event.payload,event.payload_hash,event.correlation_id,event.causation_id,
    delivery.attempts,delivery.locked_at,delivery.locked_by from public.event_outbox_deliveries delivery join public.event_outbox event on event.event_id=delivery.event_id
    where delivery.consumer_name=p_consumer_name and delivery.status='processing' and delivery.locked_by=p_worker_id order by event.available_at,event.event_id;
end $$;

