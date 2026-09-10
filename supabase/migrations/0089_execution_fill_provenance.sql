-- Read-only provider fill evidence. No order enabling, baseline declaration, or
-- legacy account inference. Existing history stays immutable and unverified.
alter table public.execution_orders add column account_id uuid references public.execution_accounts(id);
alter table public.execution_fills alter column order_id drop not null;
alter table public.execution_fills
  add column account_id uuid references public.execution_accounts(id),
  add column provider text,
  add column provider_environment text,
  add column instrument_id text,
  add column side text,
  add column base_currency text,
  add column quote_currency text,
  add column quote_currency_source text,
  add column provider_order_id text,
  add column provider_bill_id text,
  add column provider_recorded_at timestamptz,
  add column provider_fee_amount numeric,
  add column provenance_status text not null default 'LEGACY_UNVERIFIED',
  add column order_mapping_status text;
alter table public.execution_fills add constraint execution_fills_provenance_check check (
  (provenance_status='LEGACY_UNVERIFIED' and account_id is null and order_id is not null)
  or (provenance_status='VERIFIED_PROVIDER' and account_id is not null
    and provider='okx-demo' and provider_environment='DEMO'
    and instrument_id is not null and instrument_id ~ '^[A-Z0-9]{1,20}-[A-Z0-9]{1,20}$'
    and side is not null and side in ('BUY','SELL')
    and base_currency is not null and base_currency=split_part(instrument_id,'-',1)
    and quote_currency is not null and quote_currency ~ '^[A-Z0-9]{1,20}$'
    and quote_currency_source is not null and quote_currency_source='OKX_TRADE_QUOTE_CCY'
    and provider_order_id is not null and provider_order_id ~ '^[1-9][0-9]{0,39}$'
    and provider_bill_id is not null and provider_bill_id ~ '^[1-9][0-9]{0,39}$'
    and provider_fill_id ~ '^[1-9][0-9]{0,39}$'
    and quantity>0 and quantity::text not in ('NaN','Infinity','-Infinity')
    and price>0 and price::text not in ('NaN','Infinity','-Infinity')
    and fee_amount is not null and provider_fee_amount is not null
    and fee_amount=-provider_fee_amount and fee_amount::text not in ('NaN','Infinity','-Infinity')
    and fee_currency is not null and fee_currency ~ '^[A-Z0-9]{1,20}$'
    and provider_recorded_at is not null and provider_recorded_at<=available_at and occurred_at<=available_at
    and order_mapping_status is not null
    and ((order_mapping_status='MATCHED_LOCAL_ORDER' and order_id is not null)
      or (order_mapping_status='EXTERNAL_ORDER' and order_id is null)))
);
create unique index execution_fills_provider_identity_idx on public.execution_fills(account_id,provider,provider_environment,instrument_id,provider_fill_id) where provenance_status='VERIFIED_PROVIDER';
create index execution_fills_account_timeline_idx on public.execution_fills(account_id,occurred_at,id) where provenance_status='VERIFIED_PROVIDER';
create index execution_fills_account_order_idx on public.execution_fills(account_id,provider_order_id,instrument_id) where provenance_status='VERIFIED_PROVIDER';

create table public.execution_fill_sync_states (
  id uuid primary key default gen_random_uuid(), sync_key text not null unique,
  account_id uuid not null references public.execution_accounts(id), provider text not null,
  provider_environment text not null check(provider_environment in ('DEMO','SHADOW')),
  requested_start_at timestamptz not null, requested_end_at timestamptz not null,
  effective_start_at timestamptz, effective_end_at timestamptz, retention_start_at timestamptz,
  retention_limited boolean not null default false, cursor_after_bill_id text,
  exhausted boolean not null default false,
  status text not null check(status in ('PARTIAL','COMPLETE_WINDOW','RETENTION_GAP','UNSUPPORTED','FAILED')),
  reason text, source text check(source='OKX_FILLS_HISTORY_3_MONTHS'),
  time_basis text check(time_basis='PROVIDER_RECORDED_AT'),
  page_count integer not null default 0, inserted_count integer not null default 0,
  observed_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(requested_start_at<=requested_end_at),
  check(cursor_after_bill_id is null or cursor_after_bill_id ~ '^[1-9][0-9]{0,39}$'),
  check(status<>'COMPLETE_WINDOW' or (exhausted and not retention_limited and effective_start_at=requested_start_at and effective_end_at=requested_end_at)),
  unique(account_id,provider,provider_environment,requested_start_at,requested_end_at)
);
comment on table public.execution_fill_sync_states is 'Coverage of provider-generated timestamp windows only. Never certifies account baseline, funding/bills, order cumulative fills, or history outside provider retention.';
create table public.execution_fill_sync_pages (
  id uuid primary key default gen_random_uuid(), page_key text not null unique,
  sync_state_id uuid not null references public.execution_fill_sync_states(id),
  request_cursor text, response_cursor text, payload_hash text not null,
  fill_count integer not null, inserted_count integer not null,
  observed_at timestamptz not null, created_at timestamptz not null default now()
);
create index execution_fill_sync_coverage_idx on public.execution_fill_sync_states(account_id,provider,provider_environment,effective_start_at,effective_end_at) where status='COMPLETE_WINDOW' and exhausted and not retention_limited;
create index execution_fill_sync_resume_idx on public.execution_fill_sync_states(account_id,provider,provider_environment,requested_start_at) where status in ('PARTIAL','FAILED');
create trigger execution_fill_sync_pages_immutable before update or delete on public.execution_fill_sync_pages for each row execute function public.prevent_execution_history_mutation();

-- Compare immutable normalized provider facts, not retrieval timestamps or local
-- order mappings. A retry may arrive after a formerly external order is linked.
create or replace function public.persist_execution_fill_page(p_page jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare
  a public.execution_accounts%rowtype; s public.execution_fill_sync_states%rowtype;
  receipt public.execution_fill_sync_pages%rowtype; existing public.execution_fills%rowtype;
  f jsonb; facts jsonb; local_order uuid; local_matches integer;
  stamp timestamptz; requested_start timestamptz; requested_end timestamptz;
  effective_start timestamptz; effective_end timestamptz; retention_start timestamptz;
  status_value text; cursor_value text; next_cursor text; fill_hash text; fill_key_value text;
  page_key_value text; page_hash text; prior_bill numeric; bill numeric;
  inserted integer:=0; count_value integer; page_size integer; exhaustion boolean; limited boolean;
begin
  if p_page is null or jsonb_typeof(p_page)<>'object' or (p_page->>'sync_key') is null or (p_page->>'sync_key') !~ '^[0-9a-f]{64}$' then raise exception 'FILL_PAGE_INVALID'; end if;
  select * into a from public.execution_accounts where id=(p_page->>'account_id')::uuid for share;
  if not found or a.provider is distinct from p_page->>'provider' or a.provider_environment is distinct from p_page->>'provider_environment' then raise exception 'FILL_ACCOUNT_SCOPE_MISMATCH'; end if;
  requested_start:=(p_page->>'requested_start_at')::timestamptz; requested_end:=(p_page->>'requested_end_at')::timestamptz;
  stamp:=(p_page->>'observed_at')::timestamptz; status_value:=p_page->>'status'; cursor_value:=p_page->>'request_cursor';
  page_size:=(p_page->>'page_size')::integer;
  if requested_start is null or requested_end is null or requested_start>requested_end or requested_end>clock_timestamp() or stamp is null or stamp<requested_end or stamp>clock_timestamp()+interval '5 seconds' or page_size is null or page_size not between 1 and 100 or status_value is null or status_value not in ('PARTIAL','COMPLETE_WINDOW','RETENTION_GAP','UNSUPPORTED','FAILED') or jsonb_typeof(p_page->'fills') is distinct from 'array' then raise exception 'FILL_PAGE_INVALID'; end if;
  count_value:=jsonb_array_length(p_page->'fills');
  if count_value>page_size or (cursor_value is not null and cursor_value !~ '^[1-9][0-9]{0,39}$') then raise exception 'FILL_PAGE_INVALID'; end if;
  insert into public.execution_fill_sync_states(sync_key,account_id,provider,provider_environment,requested_start_at,requested_end_at,status,observed_at)
    values(p_page->>'sync_key',a.id,a.provider,a.provider_environment,requested_start,requested_end,'PARTIAL',stamp) on conflict(sync_key) do nothing;
  select * into s from public.execution_fill_sync_states where sync_key=p_page->>'sync_key' for update;
  if s.account_id<>a.id or s.provider<>a.provider or s.provider_environment<>a.provider_environment or s.requested_start_at<>requested_start or s.requested_end_at<>requested_end then raise exception 'FILL_CHECKPOINT_SCOPE_MISMATCH'; end if;
  if status_value in ('FAILED','UNSUPPORTED') then
    if count_value<>0 then raise exception 'FILL_UNAVAILABLE_PAGE_HAS_FACTS'; end if;
    if s.cursor_after_bill_id is distinct from cursor_value or s.exhausted then raise exception 'FILL_CHECKPOINT_CONCURRENT_CHANGE'; end if;
    update public.execution_fill_sync_states set status=status_value,reason=case when status_value='UNSUPPORTED' then 'PROVIDER_FILL_HISTORY_UNSUPPORTED' else 'PROVIDER_FILL_PAGE_UNAVAILABLE' end,observed_at=stamp,updated_at=clock_timestamp() where id=s.id;
    return jsonb_build_object('ok',true,'checkpoint_id',s.id,'inserted',0,'cursor_after_bill_id',s.cursor_after_bill_id,'status',status_value,'exhausted',false);
  end if;
  if a.provider<>'okx-demo' or a.provider_environment<>'DEMO' or p_page->>'source' is distinct from 'OKX_FILLS_HISTORY_3_MONTHS' or p_page->>'time_basis' is distinct from 'PROVIDER_RECORDED_AT' then raise exception 'FILL_SOURCE_UNSUPPORTED'; end if;
  effective_start:=(p_page->>'effective_start_at')::timestamptz; effective_end:=(p_page->>'effective_end_at')::timestamptz; retention_start:=(p_page->>'retention_start_at')::timestamptz;
  exhaustion:=(p_page->>'exhausted')::boolean; limited:=(p_page->>'retention_limited')::boolean; next_cursor:=p_page->>'next_cursor';
  if effective_start is null or effective_end is null or retention_start is null or exhaustion is null or limited is null or effective_start<requested_start or effective_end<>requested_end or effective_start<retention_start or (effective_start>requested_start and not limited) or (s.retention_limited and not limited) or (s.effective_start_at is not null and effective_start<s.effective_start_at) then raise exception 'FILL_WINDOW_INVALID'; end if;
  if exhaustion and (next_cursor is not null or count_value>=page_size) then raise exception 'FILL_EXHAUSTION_INVALID'; end if;
  if not exhaustion and effective_start<=effective_end and (count_value<>page_size or next_cursor is null) then raise exception 'FILL_CURSOR_MISSING'; end if;
  if effective_start>effective_end and (not limited or exhaustion or count_value<>0 or next_cursor is not null or status_value<>'RETENTION_GAP') then raise exception 'FILL_RETENTION_WINDOW_INVALID'; end if;
  if status_value='COMPLETE_WINDOW' and (not exhaustion or limited) or status_value='PARTIAL' and exhaustion or status_value='RETENTION_GAP' and not limited then raise exception 'FILL_COVERAGE_INVALID'; end if;
  page_key_value:=encode(sha256(convert_to(jsonb_build_object('sync_key',s.sync_key,'cursor',cursor_value)::text,'UTF8')),'hex');
  page_hash:=encode(sha256(convert_to(jsonb_build_object('fills',p_page->'fills','effective_start',effective_start,'effective_end',effective_end,'next_cursor',next_cursor,'exhausted',exhaustion,'limited',limited,'status',status_value)::text,'UTF8')),'hex');
  select * into receipt from public.execution_fill_sync_pages where page_key=page_key_value;
  if found then
    if receipt.payload_hash<>page_hash then raise exception 'FILL_PAGE_PAYLOAD_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'checkpoint_id',s.id,'inserted',0,'cursor_after_bill_id',s.cursor_after_bill_id,'status',s.status,'exhausted',s.exhausted);
  end if;
  if s.cursor_after_bill_id is distinct from cursor_value or s.exhausted then raise exception 'FILL_CHECKPOINT_CONCURRENT_CHANGE'; end if;
  prior_bill:=cursor_value::numeric;
  for f in select value from jsonb_array_elements(p_page->'fills') loop
    if jsonb_typeof(f)<>'object' or f->>'providerBillId' is null or f->>'providerBillId' !~ '^[1-9][0-9]{0,39}$' or f->>'providerFillId' is null or f->>'providerFillId' !~ '^[1-9][0-9]{0,39}$' or f->>'providerOrderId' is null or f->>'providerOrderId' !~ '^[1-9][0-9]{0,39}$' then raise exception 'FILL_ID_INVALID'; end if;
    bill:=(f->>'providerBillId')::numeric;
    if prior_bill is not null and bill>=prior_bill then raise exception 'FILL_CURSOR_NOT_DECREASING'; end if;
    prior_bill:=bill;
    if (f->>'providerRecordedAt')::timestamptz not between effective_start and effective_end then raise exception 'FILL_RECORD_OUTSIDE_WINDOW'; end if;
    facts:=jsonb_build_object('providerFillId',f->>'providerFillId','providerBillId',f->>'providerBillId','providerOrderId',f->>'providerOrderId','clientOrderId',f->>'clientOrderId','instrumentId',f->>'instrumentId','side',f->>'side','quantity',(f->>'quantity')::numeric,'price',(f->>'price')::numeric,'feeAmount',(f->>'feeAmount')::numeric,'providerFeeAmount',(f->>'providerFeeAmount')::numeric,'feeCurrency',f->>'feeCurrency','baseCurrency',f->>'baseCurrency','quoteCurrency',f->>'quoteCurrency','quoteCurrencySource',f->>'quoteCurrencySource','occurredAt',(f->>'occurredAt')::timestamptz,'providerRecordedAt',(f->>'providerRecordedAt')::timestamptz);
    fill_hash:=encode(sha256(convert_to(facts::text,'UTF8')),'hex');
    fill_key_value:=encode(sha256(convert_to(jsonb_build_object('account',a.id,'provider',a.provider,'environment',a.provider_environment,'instrument',f->>'instrumentId','trade',f->>'providerFillId')::text,'UTF8')),'hex');
    select count(*),min(o.id::text)::uuid into local_matches,local_order from public.execution_orders o join public.execution_intents i on i.id=o.intent_id where o.account_id=a.id and o.provider=a.provider and o.provider_environment=a.provider_environment and o.provider_order_id=f->>'providerOrderId' and i.instrument_id=f->>'instrumentId' and i.side=f->>'side';
    if local_matches>1 then raise exception 'FILL_LOCAL_ORDER_AMBIGUOUS'; end if;
    insert into public.execution_fills(fill_key,order_id,provider_fill_id,quantity,price,fee_amount,fee_currency,occurred_at,available_at,payload_hash,account_id,provider,provider_environment,instrument_id,side,base_currency,quote_currency,quote_currency_source,provider_order_id,provider_bill_id,provider_recorded_at,provider_fee_amount,provenance_status,order_mapping_status)
      values(fill_key_value,local_order,f->>'providerFillId',(f->>'quantity')::numeric,(f->>'price')::numeric,(f->>'feeAmount')::numeric,f->>'feeCurrency',(f->>'occurredAt')::timestamptz,stamp,fill_hash,a.id,a.provider,a.provider_environment,f->>'instrumentId',f->>'side',f->>'baseCurrency',f->>'quoteCurrency',f->>'quoteCurrencySource',f->>'providerOrderId',f->>'providerBillId',(f->>'providerRecordedAt')::timestamptz,(f->>'providerFeeAmount')::numeric,'VERIFIED_PROVIDER',case when local_order is null then 'EXTERNAL_ORDER' else 'MATCHED_LOCAL_ORDER' end)
      on conflict(fill_key) do nothing;
    if found then inserted:=inserted+1;
    else
      select * into existing from public.execution_fills where fill_key=fill_key_value;
      if existing.payload_hash is distinct from fill_hash or existing.provenance_status<>'VERIFIED_PROVIDER' then raise exception 'FILL_PAYLOAD_CONFLICT'; end if;
    end if;
  end loop;
  if not exhaustion and count_value>0 and next_cursor is distinct from prior_bill::text then raise exception 'FILL_CURSOR_LAST_BILL_MISMATCH'; end if;
  insert into public.execution_fill_sync_pages(page_key,sync_state_id,request_cursor,response_cursor,payload_hash,fill_count,inserted_count,observed_at) values(page_key_value,s.id,cursor_value,next_cursor,page_hash,count_value,inserted,stamp);
  update public.execution_fill_sync_states set effective_start_at=effective_start,effective_end_at=effective_end,retention_start_at=retention_start,retention_limited=limited,cursor_after_bill_id=next_cursor,exhausted=exhaustion,status=status_value,reason=case when limited then 'PROVIDER_RETENTION_LIMIT' else null end,source='OKX_FILLS_HISTORY_3_MONTHS',time_basis='PROVIDER_RECORDED_AT',page_count=page_count+1,inserted_count=inserted_count+inserted,observed_at=stamp,updated_at=clock_timestamp() where id=s.id;
  return jsonb_build_object('ok',true,'checkpoint_id',s.id,'inserted',inserted,'cursor_after_bill_id',next_cursor,'status',status_value,'exhausted',exhaustion);
end;
$$;
alter table public.execution_fill_sync_states enable row level security;
alter table public.execution_fill_sync_pages enable row level security;
revoke all on public.execution_fill_sync_states,public.execution_fill_sync_pages from public,anon,authenticated;
grant all on public.execution_fill_sync_states,public.execution_fill_sync_pages to service_role;
revoke all on function public.persist_execution_fill_page(jsonb) from public,anon,authenticated;
grant execute on function public.persist_execution_fill_page(jsonb) to service_role;

-- A bounded read result even after millions of windows. Connected timestamp
-- ranges are aggregated in PostgreSQL, not silently capped at an API row limit.
-- This remains provider-recorded-time coverage, NOT funding or fillTime coverage.
create or replace function public.execution_fill_coverage_v1(
  p_account_id uuid,p_provider text,p_environment text,p_baseline_at timestamptz,p_cutoff_at timestamptz
) returns jsonb language sql stable security invoker set search_path=public,pg_temp set timezone='UTC' as $$
  with eligible as materialized (
    select s.id,s.effective_start_at,s.effective_end_at,s.observed_at
    from public.execution_fill_sync_states s
    join public.execution_accounts a on a.id=s.account_id and a.provider=s.provider and a.provider_environment=s.provider_environment
    where s.account_id=p_account_id and s.provider=p_provider and s.provider_environment=p_environment
      and s.provider='okx-demo' and s.provider_environment='DEMO'
      and p_baseline_at is not null and p_cutoff_at is not null and p_baseline_at<=p_cutoff_at
      and s.status='COMPLETE_WINDOW' and s.exhausted is true and s.retention_limited is false
      and s.source='OKX_FILLS_HISTORY_3_MONTHS' and s.time_basis='PROVIDER_RECORDED_AT'
      and s.effective_start_at=s.requested_start_at and s.effective_end_at=s.requested_end_at
      and s.effective_start_at<=s.effective_end_at and s.retention_start_at<=s.effective_start_at
      and s.observed_at<=p_cutoff_at and s.effective_end_at<=s.observed_at and s.effective_end_at<=p_cutoff_at
      and s.effective_end_at>p_baseline_at
  ), ranges as (
    select range_agg(tstzrange(effective_start_at,effective_end_at,'[]')) value from eligible
  ), covered as (
    select r from ranges cross join lateral unnest(coalesce(value,'{}'::tstzmultirange)) r
    where r @> p_baseline_at and upper(r)>p_baseline_at limit 1
  ), members as (
    select e.* from eligible e cross join covered c where e.effective_start_at<=upper(c.r)
  )
  select jsonb_build_object('through',(select upper(r) from covered),
    'checkpointCount',count(*),
    'checkpointHash',case when count(*)=0 then null else encode(sha256(convert_to(string_agg(
      jsonb_build_array(id,effective_start_at,effective_end_at,observed_at)::text,'|' order by effective_start_at,effective_end_at,id),'UTF8')),'hex') end)
  from members;
$$;
revoke all on function public.execution_fill_coverage_v1(uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.execution_fill_coverage_v1(uuid,text,text,timestamptz,timestamptz) to service_role;
