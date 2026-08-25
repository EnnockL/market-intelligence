create or replace function public.market_regime_observation_pairs(
  p_asset_class text,
  p_cutoff timestamptz,
  p_lookback_seconds integer
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
    where a.kind='crypto' and a.is_active=true
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
    where a.kind='stock' and a.is_active=true
    order by a.id;
  end if;
end$$;

revoke all on function public.market_regime_observation_pairs(text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.market_regime_observation_pairs(text,timestamptz,integer) to service_role;
