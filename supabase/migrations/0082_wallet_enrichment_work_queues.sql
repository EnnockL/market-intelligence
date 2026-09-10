-- Small persistent scheduling state; never changes raw transactions/evidence.
create table public.ingestion_work_attempts (
  work_key text not null,
  subject_id uuid not null,
  last_attempt_at timestamptz not null default now(),
  primary key (work_key, subject_id)
);
alter table public.ingestion_work_attempts enable row level security;
revoke all on public.ingestion_work_attempts from public, anon, authenticated;
grant all on public.ingestion_work_attempts to service_role;

create index if not exists wallet_transactions_enrichment_timeline_idx
  on public.wallet_transactions(wallet_id, occurred_at, id)
  where asset_id is not null and side in ('buy', 'sell');
create index if not exists wallet_enrichment_pending_lookup_idx
  on public.wallet_transaction_enrichments(provider, enrichment_version, wallet_transaction_id);

-- Anti-join happens inside the database, before the bounded fair batch. A deep
-- historical wallet cannot hide every transaction belonging to newer wallets.
-- Attempts rotate transient failures too; failed fetches stay pending.
create or replace function public.claim_wallet_enrichment_targets(
  target_provider text, target_version text, batch_limit integer default 10,
  input_cutoff timestamptz default now()
) returns table(transaction_id uuid, wallet_id uuid, asset_id uuid,
  transaction_hash text, instruction_index integer, side text, quantity numeric,
  occurred_at timestamptz, raw_payload jsonb, mint_address text)
language sql volatile security invoker set search_path = public
as $$
  with pending as materialized (
    select t.*, c.mint_address, a.last_attempt_at, wa.last_attempt_at wallet_last_attempt_at,
      row_number() over (partition by t.wallet_id order by a.last_attempt_at nulls first, t.occurred_at, t.id) wallet_rank
    from public.wallet_transactions t
    join public.wallets w on w.id=t.wallet_id and w.is_tracked
    join public.crypto_tokens c on c.asset_id=t.asset_id
    left join public.ingestion_work_attempts a
      on a.work_key='enrich:'||target_provider||':'||target_version and a.subject_id=t.id
    left join public.ingestion_work_attempts wa
      on wa.work_key='enrich-wallet:'||target_provider||':'||target_version and wa.subject_id=t.wallet_id
    where t.side in ('buy','sell') and t.ingested_at<=input_cutoff and t.occurred_at<=input_cutoff
      and not exists (select 1 from public.wallet_transaction_enrichments e
        where e.wallet_transaction_id=t.id and e.provider=target_provider and e.enrichment_version=target_version)
  ), selected as materialized (
    select p.* from pending p
    order by p.wallet_rank, p.wallet_last_attempt_at nulls first, p.last_attempt_at nulls first, p.occurred_at, p.wallet_id, p.id
    limit greatest(1,least(coalesce(batch_limit,10),50))
  ), touched_wallets as (
    insert into public.ingestion_work_attempts(work_key,subject_id,last_attempt_at)
    select distinct 'enrich-wallet:'||target_provider||':'||target_version,s.wallet_id,statement_timestamp() from selected s
    on conflict on constraint ingestion_work_attempts_pkey do update set last_attempt_at=excluded.last_attempt_at
  ), touched as (
    insert into public.ingestion_work_attempts(work_key,subject_id,last_attempt_at)
    select 'enrich:'||target_provider||':'||target_version,s.id,clock_timestamp() from selected s
    on conflict on constraint ingestion_work_attempts_pkey do update set last_attempt_at=excluded.last_attempt_at
    returning subject_id
  )
  select s.id,s.wallet_id,s.asset_id,s.transaction_hash,s.instruction_index,s.side,s.quantity,
    s.occurred_at,s.raw_payload,s.mint_address from selected s join touched t on t.subject_id=s.id
  order by s.wallet_rank,s.wallet_last_attempt_at nulls first,s.last_attempt_at nulls first,s.occurred_at,s.wallet_id,s.id;
$$;

-- Rotate bounded work by its last attempt, independent of insert order or a
-- REST row cap. Historical evidence and live observations have separate queues.
create or replace function public.claim_ingestion_subjects(
  target_work text, subject_kind text, batch_limit integer default 10
) returns table(subject_id uuid)
language plpgsql volatile security invoker set search_path = public
as $$
begin
  if subject_kind not in ('wallet','crypto','wallet_asset') then
    raise exception 'Unsupported ingestion subject kind';
  end if;
  return query
  with eligible as (
    select w.id from public.wallets w where subject_kind='wallet' and w.is_tracked
    union all
    select c.asset_id from public.crypto_tokens c where subject_kind='crypto'
    union all
    select c.asset_id from public.crypto_tokens c where subject_kind='wallet_asset'
      and exists(select 1 from public.wallet_transactions t join public.wallets w on w.id=t.wallet_id
        where t.asset_id=c.asset_id and t.side in ('buy','sell') and w.is_tracked)
  ), selected as materialized (
    select e.id from eligible e left join public.ingestion_work_attempts a
      on a.work_key=target_work and a.subject_id=e.id
    order by a.last_attempt_at nulls first,e.id
    limit greatest(1,least(coalesce(batch_limit,10),case when subject_kind='crypto' then 250 when subject_kind='wallet' then 3 else 100 end))
  )
  insert into public.ingestion_work_attempts(work_key,subject_id,last_attempt_at)
    select target_work,s.id,clock_timestamp() from selected s
    on conflict on constraint ingestion_work_attempts_pkey do update set last_attempt_at=excluded.last_attempt_at
    returning ingestion_work_attempts.subject_id;
end;
$$;

-- Fetch a small missing historical window, not years of a token's history.
-- Coverage must already have been available at the transaction's timestamp.
create or replace function public.wallet_evidence_missing_window(target_asset uuid)
returns table(occurred_at timestamptz)
language sql stable security invoker set search_path = public
as $$
  select t.occurred_at from public.wallet_transactions t
  join public.wallets w on w.id=t.wallet_id and w.is_tracked
  where t.asset_id=target_asset and t.side in ('buy','sell')
  order by not exists (
    select 1 from public.crypto_liquidity_snapshots l where l.asset_id=t.asset_id
      and l.effective_at between t.occurred_at-interval '2 minutes' and t.occurred_at
      and l.information_available_at<=t.occurred_at
  ) desc, t.occurred_at, t.id
  limit 1;
$$;

revoke all on function public.claim_wallet_enrichment_targets(text,text,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_ingestion_subjects(text,text,integer) from public,anon,authenticated;
revoke all on function public.wallet_evidence_missing_window(uuid) from public,anon,authenticated;
grant execute on function public.claim_wallet_enrichment_targets(text,text,integer,timestamptz) to service_role;
grant execute on function public.claim_ingestion_subjects(text,text,integer) to service_role;
grant execute on function public.wallet_evidence_missing_window(uuid) to service_role;
