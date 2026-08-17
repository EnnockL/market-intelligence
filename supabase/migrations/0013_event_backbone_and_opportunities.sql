create table public.event_outbox (
  id uuid primary key default gen_random_uuid(), event_key text not null unique, event_type text not null,
  schema_version integer not null check(schema_version > 0), entity_type text not null, entity_id text not null,
  asset_id uuid references public.assets(id), wallet_id uuid references public.wallets(id),
  occurred_at timestamptz not null, observed_at timestamptz not null, available_at timestamptz not null,
  provider text not null, source_ref text not null, data_quality smallint not null check(data_quality between 0 and 100),
  payload jsonb not null default '{}', created_at timestamptz not null default now(),
  published_at timestamptz, publish_attempts integer not null default 0, last_error text,
  check(occurred_at <= observed_at and observed_at <= available_at)
);
create index event_outbox_stream_idx on public.event_outbox(event_type,available_at,id);
create index event_outbox_asset_idx on public.event_outbox(asset_id,occurred_at) where asset_id is not null;

create table public.event_consumer_cursors (
  consumer_name text primary key, last_available_at timestamptz not null, last_event_id uuid not null,
  updated_at timestamptz not null default now()
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(), opportunity_key text not null unique, asset_id uuid not null references public.assets(id),
  opportunity_type text not null, policy_version text not null, state text not null
    check(state in ('detected','fast_opportunity','enriching','qualified','watch','rejected','paper_trade_candidate')),
  detected_at timestamptz not null, last_evidence_at timestamptz not null, opportunity_score smallint not null check(opportunity_score between 0 and 100),
  risk_score smallint check(risk_score between 0 and 100), data_quality smallint not null check(data_quality between 0 and 100),
  latest_revision integer not null default 0, updated_at timestamptz not null default now()
);
create index opportunities_dashboard_idx on public.opportunities(state,detected_at desc);

create table public.opportunity_revisions (
  id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  revision integer not null, revision_key text not null, state text not null
    check(state in ('detected','fast_opportunity','enriching','qualified','watch','rejected','paper_trade_candidate')),
  evidence_event_ids uuid[] not null default '{}', wallet_ids uuid[] not null default '{}', blockers jsonb not null default '[]',
  evidence jsonb not null default '{}', opportunity_score smallint not null check(opportunity_score between 0 and 100),
  risk_score smallint check(risk_score between 0 and 100), data_quality smallint not null check(data_quality between 0 and 100),
  information_available_at timestamptz not null, created_at timestamptz not null default now(),
  unique(opportunity_id,revision), unique(opportunity_id,revision_key)
);
create index opportunity_revisions_replay_idx on public.opportunity_revisions(opportunity_id,information_available_at,revision);

create or replace function public.save_fast_flow_evaluation(
  p_opportunity_key text, p_asset_id uuid, p_policy_version text, p_state text, p_detected_at timestamptz,
  p_last_evidence_at timestamptz, p_opportunity_score smallint, p_risk_score smallint, p_data_quality smallint,
  p_revision_key text, p_event_ids uuid[], p_wallet_ids uuid[], p_blockers jsonb, p_evidence jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare target_id uuid; next_revision integer;
begin
  insert into public.opportunities(opportunity_key,asset_id,opportunity_type,policy_version,state,detected_at,last_evidence_at,opportunity_score,risk_score,data_quality)
  values(p_opportunity_key,p_asset_id,'fast_flow',p_policy_version,p_state,p_detected_at,p_last_evidence_at,p_opportunity_score,p_risk_score,p_data_quality)
  on conflict(opportunity_key) do update set state=excluded.state,last_evidence_at=excluded.last_evidence_at,
    opportunity_score=excluded.opportunity_score,risk_score=excluded.risk_score,data_quality=excluded.data_quality,updated_at=now();
  select id,latest_revision into target_id,next_revision from public.opportunities where opportunity_key=p_opportunity_key for update;
  if exists(select 1 from public.opportunity_revisions where opportunity_id=target_id and revision_key=p_revision_key) then return false; end if;
  next_revision := next_revision + 1;
  insert into public.opportunity_revisions(opportunity_id,revision,revision_key,state,evidence_event_ids,wallet_ids,blockers,evidence,opportunity_score,risk_score,data_quality,information_available_at)
  values(target_id,next_revision,p_revision_key,p_state,p_event_ids,p_wallet_ids,p_blockers,p_evidence,p_opportunity_score,p_risk_score,p_data_quality,p_last_evidence_at);
  update public.opportunities set latest_revision=next_revision where id=target_id;
  return true;
end $$;

create or replace function public.emit_wallet_trade_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.side in ('buy','sell') then
    insert into public.event_outbox(event_key,event_type,schema_version,entity_type,entity_id,asset_id,wallet_id,occurred_at,observed_at,available_at,provider,source_ref,data_quality,payload)
    values(
      'wallet-trade:' || new.wallet_id || ':' || new.transaction_hash || ':' || new.instruction_index,
      'wallet.' || new.side || '_detected',1,'wallet_transaction',new.id::text,new.asset_id,new.wallet_id,
      new.occurred_at,greatest(new.occurred_at,new.ingested_at),greatest(new.occurred_at,new.ingested_at),'solana-rpc',new.transaction_hash,100,
      jsonb_build_object('side',new.side,'quantity',new.quantity,'block_number',new.block_number,'transaction_hash',new.transaction_hash,'instruction_index',new.instruction_index)
    ) on conflict(event_key) do nothing;
  end if;
  return new;
end $$;
create trigger wallet_transaction_event_outbox after insert on public.wallet_transactions for each row execute function public.emit_wallet_trade_event();

insert into public.event_outbox(event_key,event_type,schema_version,entity_type,entity_id,asset_id,wallet_id,occurred_at,observed_at,available_at,provider,source_ref,data_quality,payload)
select 'wallet-trade:' || wallet_id || ':' || transaction_hash || ':' || instruction_index,
  'wallet.' || side || '_detected',1,'wallet_transaction',id::text,asset_id,wallet_id,occurred_at,greatest(occurred_at,ingested_at),greatest(occurred_at,ingested_at),
  'solana-rpc',transaction_hash,100,jsonb_build_object('side',side,'quantity',quantity,'block_number',block_number,'transaction_hash',transaction_hash,'instruction_index',instruction_index)
from public.wallet_transactions where side in ('buy','sell') on conflict(event_key) do nothing;

alter table public.event_outbox enable row level security;
alter table public.event_consumer_cursors enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_revisions enable row level security;
create policy "public read opportunities" on public.opportunities for select using(true);
create policy "public read opportunity revisions" on public.opportunity_revisions for select using(true);
grant select on public.opportunities,public.opportunity_revisions to anon,authenticated;
grant all privileges on public.event_outbox,public.event_consumer_cursors,public.opportunities,public.opportunity_revisions to service_role;
revoke all on function public.save_fast_flow_evaluation(text,uuid,text,text,timestamptz,timestamptz,smallint,smallint,smallint,text,uuid[],uuid[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_fast_flow_evaluation(text,uuid,text,text,timestamptz,timestamptz,smallint,smallint,smallint,text,uuid[],uuid[],jsonb,jsonb) to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check(job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow'));
