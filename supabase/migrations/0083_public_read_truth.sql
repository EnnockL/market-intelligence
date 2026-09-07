-- Small bounded public read models. No history is changed and no worker is run.
create index if not exists qualification_evaluations_latest_read_idx
  on public.qualification_evaluations(information_cutoff_at desc, id desc);
create index if not exists qualification_aggregate_latest_read_idx
  on public.qualification_aggregate_snapshots(created_at desc);
create index if not exists jackpot_candidates_latest_read_idx
  on public.jackpot_candidates(detected_at desc, id desc);
create index if not exists ingestion_runs_window_read_idx on public.ingestion_runs(started_at desc);
create index if not exists provider_errors_window_read_idx on public.provider_errors(occurred_at desc);
create index if not exists market_prices_window_read_idx on public.market_prices(captured_at desc);
create index if not exists market_candles_ingestion_read_idx on public.market_candles(created_at desc);
create index if not exists wallet_transactions_ingestion_read_idx on public.wallet_transactions(ingested_at desc);

create or replace function public.data_operations_window_summary(p_since timestamptz, p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_since is null or p_until is null or p_until <= p_since or p_until - p_since > interval '7 days' then
    raise exception 'A valid window of at most seven days is required';
  end if;
  select jsonb_build_object(
    'records_processed', coalesce(sum(r.records_processed), 0),
    'succeeded', count(*) filter (where r.status = 'succeeded'),
    'failed', count(*) filter (where r.status = 'failed'),
    'provider_errors', (select count(*) from public.provider_errors e where e.occurred_at >= p_since and e.occurred_at < p_until),
    'since', p_since, 'until', p_until
  ) into result from public.ingestion_runs r where r.started_at >= p_since and r.started_at < p_until;
  return result;
end;
$$;
revoke all on function public.data_operations_window_summary(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.data_operations_window_summary(timestamptz,timestamptz) to service_role;

create or replace function public.wallet_promotion_read_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('total', count(*),
    'candidate', count(*) filter (where status = 'candidate'),
    'tracked', count(*) filter (where status = 'tracked'),
    'reviewing', count(*) filter (where status = 'reviewing'),
    'verified', count(*) filter (where status = 'verified'),
    'rejected', count(*) filter (where status = 'rejected'))
  from public.wallet_discovery_candidates;
$$;
revoke all on function public.wallet_promotion_read_counts() from public, anon, authenticated;
grant execute on function public.wallet_promotion_read_counts() to service_role;
