-- Depends on 0082. Availability, not just the effective timestamp, determines
-- whether an observation could have been used for the historical trade.
create or replace function public.wallet_has_liquidity_evidence_at(
  target_asset uuid, target_at timestamptz
) returns boolean language sql stable security invoker
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.crypto_liquidity_snapshots l
    where l.asset_id = target_asset
      and l.effective_at between target_at - interval '2 minutes' and target_at
      and l.information_available_at <= target_at
      and l.liquidity_usd >= 0
  );
$$;

-- Keep the existing RPC shape but claim a fair window instead of repeatedly
-- reading the oldest missing transaction. Each attempt has a five-minute
-- cooldown even when a provider returns no historical evidence. This is work
-- scheduling, NOT proof that the window has become covered.
create or replace function public.wallet_evidence_missing_window(target_asset uuid)
returns table(occurred_at timestamptz)
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  selected_id uuid;
  selected_at timestamptz;
begin
  if target_asset is null then raise exception 'WALLET_EVIDENCE_ASSET_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet-evidence-window:' || target_asset::text, 0));
  select t.id, t.occurred_at into selected_id, selected_at
  from public.wallet_transactions t
  join public.wallets w on w.id = t.wallet_id and w.is_tracked
  left join public.ingestion_work_attempts a
    on a.work_key = 'wallet-evidence-window-v1' and a.subject_id = t.id
  where t.asset_id = target_asset and t.side in ('buy', 'sell')
    and t.occurred_at <= statement_timestamp() and t.ingested_at <= statement_timestamp()
    and (a.last_attempt_at is null or a.last_attempt_at <= statement_timestamp() - interval '5 minutes')
  order by public.wallet_has_liquidity_evidence_at(t.asset_id, t.occurred_at),
    a.last_attempt_at nulls first, t.occurred_at, t.id
  limit 1;
  if not found then return; end if;

  insert into public.ingestion_work_attempts(work_key, subject_id, last_attempt_at)
    values ('wallet-evidence-window-v1', selected_id, clock_timestamp())
    on conflict on constraint ingestion_work_attempts_pkey
      do update set last_attempt_at = excluded.last_attempt_at;
  -- Covered windows remain a fallback so current token-risk refresh does not
  -- disappear simply because historical liquidity has already been collected.
  return query select selected_at;
end;
$$;

revoke all on function public.wallet_has_liquidity_evidence_at(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.wallet_evidence_missing_window(uuid) from public,anon,authenticated;
grant execute on function public.wallet_has_liquidity_evidence_at(uuid,timestamptz) to service_role;
grant execute on function public.wallet_evidence_missing_window(uuid) to service_role;
