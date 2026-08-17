drop function if exists public.save_fast_flow_evaluation(text,uuid,text,text,timestamptz,timestamptz,smallint,smallint,smallint,text,uuid[],uuid[],jsonb,jsonb);
drop table if exists public.event_consumer_cursors;

alter table public.event_outbox rename column event_key to event_id;
alter table public.event_outbox rename column source_ref to source_reference;
alter table public.event_outbox add column confidence smallint check(confidence between 0 and 100);
alter table public.event_outbox add column payload_hash text;
alter table public.event_outbox add column correlation_id text;
alter table public.event_outbox add column causation_id text;
alter table public.event_outbox add column status text not null default 'pending'
  check(status in ('pending','processing','processed','failed'));
alter table public.event_outbox add column next_attempt_at timestamptz not null default now();
alter table public.event_outbox add column locked_at timestamptz;
alter table public.event_outbox add column locked_by text;
alter table public.event_outbox add column processed_at timestamptz;
alter table public.event_outbox rename column publish_attempts to attempts;
alter table public.event_outbox drop column published_at;
update public.event_outbox set payload_hash=encode(digest(payload::text,'sha256'),'hex') where payload_hash is null;
alter table public.event_outbox alter column payload_hash set not null;
alter table public.event_outbox add constraint event_outbox_payload_hash_format check(payload_hash ~ '^[0-9a-f]{64}$');
alter table public.event_outbox add constraint event_outbox_lock_consistency check(
  (status='processing' and locked_at is not null and locked_by is not null) or
  (status<>'processing' and locked_at is null and locked_by is null)
);
create index event_outbox_claim_idx on public.event_outbox(status,next_attempt_at,available_at,id);

create or replace function public.claim_outbox_events(p_worker_id text, p_limit integer default 50, p_lock_timeout_seconds integer default 60)
returns setof public.event_outbox language plpgsql security definer set search_path=public as $$
begin
  if length(trim(p_worker_id))=0 then raise exception 'worker id is required'; end if;
  return query
  update public.event_outbox e set status='processing',attempts=e.attempts+1,locked_at=now(),locked_by=p_worker_id,last_error=null
  where e.id in (
    select candidate.id from public.event_outbox candidate
    where (
      (candidate.status in ('pending','failed') and candidate.next_attempt_at<=now()) or
      (candidate.status='processing' and candidate.locked_at < now() - make_interval(secs=>greatest(1,p_lock_timeout_seconds)))
    )
    order by candidate.available_at,candidate.id limit least(greatest(p_limit,1),500) for update skip locked
  ) returning e.*;
end $$;

create or replace function public.complete_outbox_event(p_event_id text,p_worker_id text)
returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  update public.event_outbox set status='processed',processed_at=now(),locked_at=null,locked_by=null,last_error=null
  where event_id=p_event_id and status='processing' and locked_by=p_worker_id;
  get diagnostics affected=row_count; return affected=1;
end $$;

create or replace function public.fail_outbox_event(p_event_id text,p_worker_id text,p_error text,p_retry_delay_seconds integer default 5)
returns boolean language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  update public.event_outbox set status='failed',next_attempt_at=now()+make_interval(secs=>least(greatest(p_retry_delay_seconds,1),3600)),
    locked_at=null,locked_by=null,last_error=left(p_error,4000)
  where event_id=p_event_id and status='processing' and locked_by=p_worker_id;
  get diagnostics affected=row_count; return affected=1;
end $$;

create or replace function public.emit_wallet_trade_event() returns trigger language plpgsql security definer set search_path=public as $$
declare event_payload jsonb; stable_event_id text;
begin
  if new.side in ('buy','sell') then
    event_payload := jsonb_build_object('side',new.side,'quantity',new.quantity,'block_number',new.block_number,'transaction_hash',new.transaction_hash,'instruction_index',new.instruction_index);
    stable_event_id := 'evt_' || substr(encode(digest('solana-rpc|' || new.transaction_hash || '|' || new.instruction_index || '|' || new.wallet_id || '|' || new.side,'sha256'),'hex'),1,40);
    insert into public.event_outbox(event_id,event_type,schema_version,entity_type,entity_id,asset_id,wallet_id,occurred_at,observed_at,available_at,provider,source_reference,data_quality,confidence,payload,payload_hash,correlation_id,causation_id)
    values(stable_event_id,'wallet.' || new.side || '_detected',1,'wallet_transaction',new.id::text,new.asset_id,new.wallet_id,new.occurred_at,
      greatest(new.occurred_at,new.ingested_at),greatest(new.occurred_at,new.ingested_at),'solana-rpc',new.transaction_hash,100,100,event_payload,
      encode(digest(event_payload::text,'sha256'),'hex'),new.transaction_hash,null)
    on conflict(event_id) do nothing;
  end if; return new;
end $$;

alter table public.opportunities rename column state to current_state;
alter table public.opportunities rename column latest_revision to current_revision;
alter table public.opportunities add column created_from_event_id text references public.event_outbox(event_id);
update public.opportunities opportunity set created_from_event_id=(
  select event.event_id from public.opportunity_revisions revision
  cross join lateral unnest(revision.evidence_event_ids) event_internal_id
  join public.event_outbox event on event.id=event_internal_id
  where revision.opportunity_id=opportunity.id order by revision.revision limit 1
) where created_from_event_id is null;
alter table public.opportunities alter column created_from_event_id set not null;

alter table public.opportunity_revisions rename column revision to revision_number;
alter table public.opportunity_revisions rename column information_available_at to information_cutoff_at;
alter table public.opportunity_revisions add column revision_type text not null default 'v0_fast_safety'
  check(revision_type in ('v0_fast_safety','v1_smart_money','v2_risk_liquidity','v3_information','v4_meta'));
alter table public.opportunity_revisions add column trigger_event_id text references public.event_outbox(event_id);
alter table public.opportunity_revisions add column evidence_refs jsonb not null default '[]';
alter table public.opportunity_revisions add column agent_outputs jsonb not null default '{}';
alter table public.opportunity_revisions add column safety_result jsonb not null default '{}';
update public.opportunity_revisions revision set trigger_event_id=opportunity.created_from_event_id
from public.opportunities opportunity where revision.opportunity_id=opportunity.id and revision.trigger_event_id is null;
alter table public.opportunity_revisions alter column trigger_event_id set not null;

create table public.evidence_records (
  evidence_id text primary key, evidence_type text not null, source_table text not null, source_record_id text not null,
  available_at timestamptz not null, payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(source_table,source_record_id)
);
create index evidence_records_time_idx on public.evidence_records(available_at,evidence_id);

create table public.opportunity_revision_evidence (
  opportunity_revision_id uuid not null references public.opportunity_revisions(id),
  evidence_id text not null references public.evidence_records(evidence_id), primary key(opportunity_revision_id,evidence_id)
);

create or replace function public.valid_opportunity_transition(p_current text,p_next text) returns boolean language sql immutable as $$
  select case p_current
    when 'detected' then p_next in ('detected','fast_opportunity','enriching','watch','rejected')
    when 'fast_opportunity' then p_next in ('fast_opportunity','enriching','qualified','watch','rejected')
    when 'enriching' then p_next in ('enriching','qualified','watch','rejected')
    when 'qualified' then p_next in ('qualified','watch','rejected','paper_trade_candidate')
    when 'watch' then p_next in ('watch','enriching','qualified','rejected')
    when 'rejected' then p_next in ('rejected','enriching')
    when 'paper_trade_candidate' then p_next in ('paper_trade_candidate','watch','rejected')
    else false end;
$$;

create or replace function public.create_opportunity_v1(p_opportunity_id uuid,p_opportunity_key text,p_asset_id uuid,p_opportunity_type text,p_detected_at timestamptz,p_created_from_event_id text,p_policy_version text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result_id uuid; source_event public.event_outbox;
begin
  select * into source_event from public.event_outbox where event_id=p_created_from_event_id;
  if not found then raise exception 'Source event not found'; end if;
  if source_event.asset_id is distinct from p_asset_id then raise exception 'Source event asset mismatch'; end if;
  if p_detected_at<source_event.available_at then raise exception 'Opportunity cannot be detected before source event is available'; end if;
  insert into public.opportunities(id,opportunity_key,asset_id,opportunity_type,policy_version,current_state,detected_at,last_evidence_at,opportunity_score,risk_score,data_quality,current_revision,created_from_event_id)
  values(p_opportunity_id,p_opportunity_key,p_asset_id,p_opportunity_type,p_policy_version,'detected',p_detected_at,source_event.available_at,0,null,source_event.data_quality,0,p_created_from_event_id)
  on conflict(opportunity_key) do nothing returning id into result_id;
  if result_id is null then select id into result_id from public.opportunities where opportunity_key=p_opportunity_key; end if;
  return result_id;
end $$;

create or replace function public.append_opportunity_revision_v1(
  p_opportunity_id uuid,p_revision_key text,p_revision_type text,p_next_state text,p_created_at timestamptz,p_information_cutoff_at timestamptz,
  p_trigger_event_id text,p_evidence_ids text[],p_agent_outputs jsonb,p_safety_result jsonb,p_opportunity_score smallint,p_risk_score smallint,p_data_quality smallint
) returns boolean language plpgsql security definer set search_path=public as $$
declare opportunity public.opportunities; next_revision integer; revision_id uuid; bad_evidence text; refs jsonb;
begin
  select * into opportunity from public.opportunities where id=p_opportunity_id for update;
  if not found then raise exception 'Opportunity not found'; end if;
  if not public.valid_opportunity_transition(opportunity.current_state,p_next_state) then raise exception 'Invalid opportunity transition: % -> %',opportunity.current_state,p_next_state; end if;
  if p_information_cutoff_at>p_created_at then raise exception 'Information cutoff cannot be after revision creation'; end if;
  if not exists(select 1 from public.event_outbox where event_id=p_trigger_event_id and available_at<=p_information_cutoff_at) then raise exception 'Trigger event unavailable at information cutoff'; end if;
  if cardinality(p_evidence_ids) <> (select count(distinct value) from unnest(p_evidence_ids) value) then raise exception 'Duplicate evidence reference'; end if;
  select requested.value into bad_evidence from unnest(p_evidence_ids) requested(value)
    left join public.evidence_records evidence on evidence.evidence_id=requested.value
    where evidence.evidence_id is null or evidence.available_at>p_information_cutoff_at limit 1;
  if bad_evidence is not null then raise exception 'Evidence unavailable at information cutoff: %',bad_evidence; end if;
  if exists(select 1 from public.opportunity_revisions where opportunity_id=p_opportunity_id and revision_key=p_revision_key) then return false; end if;
  next_revision:=opportunity.current_revision+1;
  select coalesce(jsonb_agg(jsonb_build_object('evidence_id',evidence_id,'evidence_type',evidence_type,'available_at',available_at,'payload_hash',payload_hash) order by evidence_id),'[]'::jsonb)
    into refs from public.evidence_records where evidence_id=any(p_evidence_ids);
  insert into public.opportunity_revisions(opportunity_id,revision_number,revision_key,revision_type,state,evidence_event_ids,wallet_ids,blockers,evidence,
    opportunity_score,risk_score,data_quality,information_cutoff_at,trigger_event_id,evidence_refs,agent_outputs,safety_result,created_at)
  values(p_opportunity_id,next_revision,p_revision_key,p_revision_type,p_next_state,'{}','{}','[]','{}',p_opportunity_score,p_risk_score,p_data_quality,
    p_information_cutoff_at,p_trigger_event_id,refs,p_agent_outputs,p_safety_result,p_created_at) returning id into revision_id;
  insert into public.opportunity_revision_evidence(opportunity_revision_id,evidence_id) select revision_id,unnest(p_evidence_ids);
  update public.opportunities set current_state=p_next_state,current_revision=next_revision,last_evidence_at=p_information_cutoff_at,
    opportunity_score=p_opportunity_score,risk_score=p_risk_score,data_quality=p_data_quality,updated_at=now() where id=p_opportunity_id;
  return true;
end $$;

create or replace function public.prevent_immutable_revision_mutation() returns trigger language plpgsql as $$
begin raise exception 'Opportunity revisions and evidence links are immutable'; end $$;
create trigger opportunity_revisions_immutable before update or delete on public.opportunity_revisions for each row execute function public.prevent_immutable_revision_mutation();
create trigger opportunity_revision_evidence_immutable before update or delete on public.opportunity_revision_evidence for each row execute function public.prevent_immutable_revision_mutation();
create trigger evidence_records_immutable before update or delete on public.evidence_records for each row execute function public.prevent_immutable_revision_mutation();

alter table public.evidence_records enable row level security;
alter table public.opportunity_revision_evidence enable row level security;
create policy "public read evidence registry" on public.evidence_records for select using(true);
create policy "public read opportunity evidence links" on public.opportunity_revision_evidence for select using(true);
grant select on public.evidence_records,public.opportunity_revision_evidence to anon,authenticated;
grant all privileges on public.evidence_records,public.opportunity_revision_evidence to service_role;

revoke all on function public.claim_outbox_events(text,integer,integer),public.complete_outbox_event(text,text),public.fail_outbox_event(text,text,text,integer),
  public.create_opportunity_v1(uuid,text,uuid,text,timestamptz,text,text),
  public.append_opportunity_revision_v1(uuid,text,text,text,timestamptz,timestamptz,text,text[],jsonb,jsonb,smallint,smallint,smallint) from public,anon,authenticated;
grant execute on function public.claim_outbox_events(text,integer,integer),public.complete_outbox_event(text,text),public.fail_outbox_event(text,text,text,integer),
  public.create_opportunity_v1(uuid,text,uuid,text,timestamptz,text,text),
  public.append_opportunity_revision_v1(uuid,text,text,text,timestamptz,timestamptz,text,text[],jsonb,jsonb,smallint,smallint,smallint) to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check(job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence'));
