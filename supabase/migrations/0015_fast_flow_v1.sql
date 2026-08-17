create table public.event_outbox_deliveries (
  consumer_name text not null, event_id text not null references public.event_outbox(event_id),
  status text not null default 'pending' check(status in ('pending','processing','processed','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(), locked_at timestamptz,
  locked_by text, processed_at timestamptz, last_error text, created_at timestamptz not null default now(),
  primary key(consumer_name,event_id), check((status='processing' and locked_at is not null and locked_by is not null) or (status<>'processing' and locked_at is null and locked_by is null))
);
create index event_delivery_claim_idx on public.event_outbox_deliveries(consumer_name,status,next_attempt_at,event_id);

create or replace function public.claim_outbox_events_for_consumer(p_consumer_name text,p_event_types text[],p_worker_id text,p_limit integer default 50,p_lock_timeout_seconds integer default 60)
returns table(event_id text,schema_version integer,event_type text,entity_type text,entity_id text,asset_id uuid,occurred_at timestamptz,
  observed_at timestamptz,available_at timestamptz,provider text,source_reference text,data_quality smallint,confidence smallint,payload jsonb,
  payload_hash text,correlation_id text,causation_id text,attempts integer,locked_at timestamptz,locked_by text)
language plpgsql security definer set search_path=public as $$
begin
  if length(trim(p_consumer_name))=0 or length(trim(p_worker_id))=0 then raise exception 'consumer and worker ids are required'; end if;
  insert into public.event_outbox_deliveries(consumer_name,event_id)
    select p_consumer_name,event.event_id from public.event_outbox event
    where event.event_type=any(p_event_types) and event.available_at<=now() on conflict do nothing;
  update public.event_outbox_deliveries delivery set status='processing',attempts=delivery.attempts+1,locked_at=now(),locked_by=p_worker_id,last_error=null
  where (delivery.consumer_name,delivery.event_id) in (
    select candidate.consumer_name,candidate.event_id from public.event_outbox_deliveries candidate join public.event_outbox event on event.event_id=candidate.event_id
    where candidate.consumer_name=p_consumer_name and ((candidate.status in ('pending','failed') and candidate.next_attempt_at<=now()) or
      (candidate.status='processing' and candidate.locked_at<now()-make_interval(secs=>greatest(1,p_lock_timeout_seconds))))
    order by event.available_at,event.event_id limit least(greatest(p_limit,1),500) for update of candidate skip locked
  );
  return query select event.event_id,event.schema_version,event.event_type,event.entity_type,event.entity_id,event.asset_id,event.occurred_at,event.observed_at,
    event.available_at,event.provider,event.source_reference,event.data_quality,event.confidence,event.payload,event.payload_hash,event.correlation_id,event.causation_id,
    delivery.attempts,delivery.locked_at,delivery.locked_by from public.event_outbox_deliveries delivery join public.event_outbox event on event.event_id=delivery.event_id
    where delivery.consumer_name=p_consumer_name and delivery.status='processing' and delivery.locked_by=p_worker_id order by event.available_at,event.event_id;
end $$;

create or replace function public.complete_outbox_delivery(p_consumer_name text,p_event_id text,p_worker_id text) returns boolean
language plpgsql security definer set search_path=public as $$ declare affected integer; begin
  update public.event_outbox_deliveries set status='processed',processed_at=now(),locked_at=null,locked_by=null,last_error=null
    where consumer_name=p_consumer_name and event_id=p_event_id and status='processing' and locked_by=p_worker_id;
  get diagnostics affected=row_count; return affected=1; end $$;
create or replace function public.fail_outbox_delivery(p_consumer_name text,p_event_id text,p_worker_id text,p_error text,p_retry_delay_seconds integer default 5) returns boolean
language plpgsql security definer set search_path=public as $$ declare affected integer; begin
  update public.event_outbox_deliveries set status='failed',next_attempt_at=now()+make_interval(secs=>least(greatest(p_retry_delay_seconds,1),3600)),
    locked_at=null,locked_by=null,last_error=left(p_error,4000) where consumer_name=p_consumer_name and event_id=p_event_id and status='processing' and locked_by=p_worker_id;
  get diagnostics affected=row_count; return affected=1; end $$;

create table public.wallet_relationship_observations (
  id uuid primary key default gen_random_uuid(), wallet_a_id uuid not null references public.wallets(id), wallet_b_id uuid not null references public.wallets(id),
  relationship_type text not null check(relationship_type in ('same_owner','shared_funding','bot_cluster','mev_cluster','independent')),
  is_related boolean not null, confidence smallint not null check(confidence between 0 and 100), provider text not null,
  observed_at timestamptz not null, available_at timestamptz not null, evidence jsonb not null default '{}',
  wallet_pair_key text generated always as (least(wallet_a_id::text,wallet_b_id::text)||':'||greatest(wallet_a_id::text,wallet_b_id::text)) stored,
  check(wallet_a_id<>wallet_b_id),check(observed_at<=available_at),unique(wallet_pair_key,relationship_type,provider,observed_at)
);
create index wallet_relationship_time_idx on public.wallet_relationship_observations(wallet_pair_key,available_at desc);
alter table public.event_outbox_deliveries enable row level security;
alter table public.wallet_relationship_observations enable row level security;
grant all privileges on public.event_outbox_deliveries,public.wallet_relationship_observations to service_role;
revoke all on function public.claim_outbox_events_for_consumer(text,text[],text,integer,integer),public.complete_outbox_delivery(text,text,text),public.fail_outbox_delivery(text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_outbox_events_for_consumer(text,text[],text,integer,integer),public.complete_outbox_delivery(text,text,text),public.fail_outbox_delivery(text,text,text,text,integer) to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check(job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow'));
