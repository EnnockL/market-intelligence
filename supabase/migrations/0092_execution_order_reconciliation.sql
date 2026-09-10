-- Read-only provider observations, not fills or submission authorization.
-- The revision detects any local order change while a provider read is in flight.
alter table public.execution_orders add column reconciliation_revision bigint not null default 0;
create or replace function public.bump_execution_order_reconciliation_revision()
returns trigger language plpgsql set search_path=public as $$
begin
  new.reconciliation_revision := old.reconciliation_revision + 1;
  return new;
end;
$$;
create trigger execution_order_reconciliation_revision before update on public.execution_orders
for each row execute function public.bump_execution_order_reconciliation_revision();

create or replace function public.persist_execution_order_observation(
  p_order_id uuid, p_provider text, p_environment text, p_instrument_id text,
  p_client_order_id text, p_expected_revision bigint, p_observation jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp set timezone='UTC' as $$
declare
  o public.execution_orders%rowtype; i public.execution_intents%rowtype;
  stamp timestamptz; current_at timestamptz; quantity_value numeric; price_value numeric;
  desired text; provider_id text; facts jsonb; event_key_value text; reason text;
begin
  select * into o from public.execution_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('status','REJECTED','reason','ORDER_UNKNOWN'); end if;
  select * into i from public.execution_intents where id=o.intent_id;
  if p_provider is null or p_environment is null or p_environment not in ('SHADOW','DEMO')
    or o.provider is distinct from p_provider or o.provider_environment is distinct from p_environment
    or o.client_order_id is distinct from p_client_order_id or i.instrument_id is distinct from p_instrument_id then
    return jsonb_build_object('status','REJECTED','reason','ORDER_SCOPE_MISMATCH');
  end if;
  if p_expected_revision is null or p_expected_revision<0 then
    return jsonb_build_object('status','REJECTED','reason','ORDER_REVISION_UNKNOWN');
  end if;
  current_at:=clock_timestamp();
  if p_observation is null then
    -- A missing provider order is uncertainty, never cancellation or zero fills.
    desired:='RECONCILIATION_REQUIRED'; stamp:=current_at;
    quantity_value:=o.filled_quantity; price_value:=o.average_price; provider_id:=o.provider_order_id;
    reason:='PROVIDER_ORDER_NOT_FOUND';
    facts:=jsonb_build_object('version','execution-order-observation-v1','missing',true,'expectedRevision',p_expected_revision);
  else
    if jsonb_typeof(p_observation) is distinct from 'object'
      or p_observation->>'version' is distinct from 'execution-order-observation-v1'
      or p_observation->>'clientOrderId' is distinct from o.client_order_id
      or nullif(p_observation->>'providerOrderId','') is null
      or length(p_observation->>'providerOrderId')>128
      or p_observation->>'state' is null
      or p_observation->>'state' not in ('ACKNOWLEDGED','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED')
      or jsonb_typeof(p_observation->'filledQuantity') is distinct from 'number'
      or not (p_observation ? 'averagePrice')
      or jsonb_typeof(p_observation->'averagePrice') not in ('number','null')
      or jsonb_typeof(p_observation->'observedAt') is distinct from 'string' then
      return jsonb_build_object('status','REJECTED','reason','OBSERVATION_INVALID');
    end if;
    begin
      stamp:=(p_observation->>'observedAt')::timestamptz;
      quantity_value:=(p_observation->>'filledQuantity')::numeric;
      price_value:=(p_observation->>'averagePrice')::numeric;
    exception when others then
      return jsonb_build_object('status','REJECTED','reason','OBSERVATION_INVALID');
    end;
    desired:=p_observation->>'state'; provider_id:=p_observation->>'providerOrderId';
    if stamp is null or not isfinite(stamp) or stamp>current_at
      or quantity_value<0 or quantity_value::text in ('NaN','Infinity','-Infinity')
      or (price_value is not null and (price_value<=0 or price_value::text in ('NaN','Infinity','-Infinity')))
      or (quantity_value>0 and price_value is null)
      or (quantity_value=0 and price_value is not null)
      or (o.provider_order_id is not null and o.provider_order_id is distinct from provider_id) then
      return jsonb_build_object('status','REJECTED','reason','OBSERVATION_INVALID');
    end if;
    facts:=jsonb_build_object('version','execution-order-observation-v1','providerOrderId',provider_id,
      'clientOrderId',o.client_order_id,'state',desired,'filledQuantity',quantity_value,
      'averagePrice',price_value,'observedAt',stamp);
    reason:='RECONCILED_PROVIDER_OBSERVATION';
  end if;
  event_key_value:='reconcile_'||encode(sha256(convert_to(jsonb_build_object('order',o.id,'facts',facts)::text,'UTF8')),'hex');
  if exists(select 1 from public.execution_order_events where event_key=event_key_value) then
    return jsonb_build_object('status','DUPLICATE','orderId',o.id,'state',o.current_state,'revision',o.reconciliation_revision);
  end if;
  if o.reconciliation_revision<>p_expected_revision then
    return jsonb_build_object('status','REJECTED','reason','ORDER_CHANGED_DURING_READ');
  end if;
  if o.current_state not in ('SUBMITTING','SUBMITTED','ACKNOWLEDGED','PARTIALLY_FILLED','RECONCILIATION_REQUIRED') then
    return jsonb_build_object('status','REJECTED','reason','ORDER_TERMINAL_OR_NOT_SUBMITTED');
  end if;
  if p_observation is not null then
    if stamp=o.last_provider_observed_at and desired=o.current_state
      and quantity_value=o.filled_quantity and price_value is not distinct from o.average_price
      and provider_id=o.provider_order_id then
      return jsonb_build_object('status','UNCHANGED','orderId',o.id,'state',o.current_state,'revision',o.reconciliation_revision);
    end if;
    if o.last_provider_observed_at is not null and stamp<=o.last_provider_observed_at then
      return jsonb_build_object('status','REJECTED','reason','OBSERVATION_NOT_NEWER');
    end if;
    if o.filled_quantity<0 or o.filled_quantity::text in ('NaN','Infinity','-Infinity')
      or quantity_value<o.filled_quantity
      or (i.quantity is not null and (i.quantity<=0 or i.quantity::text in ('NaN','Infinity','-Infinity') or quantity_value>i.quantity))
      or (i.quantity is null and quantity_value>0)
      or (desired in ('ACKNOWLEDGED','REJECTED') and quantity_value<>0)
      or (desired='PARTIALLY_FILLED' and (quantity_value<=0 or i.quantity is null or quantity_value>=i.quantity))
      or (desired='FILLED' and (i.quantity is null or quantity_value<>i.quantity)) then
      return jsonb_build_object('status','REJECTED','reason','FILL_QUANTITY_CONFLICT');
    end if;
    -- A changed cumulative average without new quantity is a correction requiring
    -- investigation. Receipt time is not an exchange sequence number.
    if quantity_value=o.filled_quantity and quantity_value>0 and price_value is distinct from o.average_price then
      return jsonb_build_object('status','REJECTED','reason','AVERAGE_PRICE_CORRECTION_UNVERIFIED');
    end if;
  end if;
  update public.execution_orders set current_state=desired, provider_order_id=provider_id,
    filled_quantity=quantity_value, average_price=price_value,
    last_provider_observed_at=case when p_observation is null then o.last_provider_observed_at else stamp end,
    updated_at=current_at where id=o.id;
  insert into public.execution_order_events(event_key,order_id,previous_state,next_state,reason,provider_reference,payload,occurred_at,available_at)
    values(event_key_value,o.id,o.current_state,desired,reason,provider_id,facts,stamp,current_at);
  return jsonb_build_object('status',case when p_observation is null then 'UNRESOLVED' else 'APPLIED' end,
    'orderId',o.id,'state',desired,'revision',o.reconciliation_revision+1);
end;
$$;
revoke all on function public.persist_execution_order_observation(uuid,text,text,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.persist_execution_order_observation(uuid,text,text,text,text,bigint,jsonb) to service_role;
comment on function public.persist_execution_order_observation(uuid,text,text,text,text,bigint,jsonb) is
  'Atomic account-order observation only. Does not invent fills, authorize orders, verify external account binding, or establish cross-order reservations.';
