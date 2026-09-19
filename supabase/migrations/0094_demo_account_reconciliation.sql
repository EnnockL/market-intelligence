-- Read-only DEMO evidence and explicit observed baseline. No enable flags.
alter table public.execution_accounts add column provider_account_id text, add column demo_baseline jsonb;
create table public.demo_account_captures (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.execution_accounts(id),
  evidence_hash text not null, record jsonb not null, created_at timestamptz not null default clock_timestamp(),
  unique(account_id,evidence_hash)
);
alter table public.demo_account_captures enable row level security;
revoke all on public.demo_account_captures from public,anon,authenticated;
grant select,insert on public.demo_account_captures to service_role;
create trigger demo_account_captures_immutable before update or delete on public.demo_account_captures
for each row execute function public.prevent_execution_history_mutation();
alter table public.risk_ledger_snapshots add column demo_capture_id uuid references public.demo_account_captures(id);
create table public.demo_capture_claims (
  capture_id uuid primary key references public.demo_account_captures(id),
  order_id uuid not null unique references public.execution_orders(id), created_at timestamptz not null default clock_timestamp()
);
alter table public.demo_capture_claims enable row level security;
revoke all on public.demo_capture_claims from public,anon,authenticated,service_role;
grant select on public.demo_capture_claims to service_role;

create function public.prepare_demo_account_baseline(p_provider text,p_baseline jsonb,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.execution_accounts;
begin
  if p_provider is distinct from 'okx-demo' or p_baseline->>'version' is distinct from 'demo-account-baseline-v1'
    or p_evidence->>'version' is distinct from 'demo-account-evidence-v1' or p_evidence->>'complete' is distinct from 'true'
    or p_baseline->>'externalAccountId' is null or p_baseline->>'instrumentId' is null
    or p_baseline->>'externalAccountId' is distinct from p_evidence->>'externalAccountId'
    or p_baseline->>'instrumentId' is distinct from p_evidence->>'instrumentId'
    or p_baseline->>'at' is distinct from p_evidence->>'startedAt'
    or p_baseline->>'cash' is null or p_baseline->>'at' is null or p_evidence->>'observedAt' is null
    or p_baseline->>'baseCurrency' is null or p_baseline->>'quoteCurrency' is null
    or p_baseline->>'baseCurrency' is distinct from p_evidence->>'baseCurrency'
    or p_baseline->>'quoteCurrency' is distinct from p_evidence->>'quoteCurrency'
    or jsonb_typeof(p_evidence->'balances') is distinct from 'array'
    or (p_baseline->>'cash')::numeric <= 0
    or (p_baseline->>'cash')::numeric::text in ('NaN','Infinity','-Infinity')
    or jsonb_typeof(p_evidence->'orders') is distinct from 'array' or p_evidence->'orders' <> '[]'::jsonb
    or jsonb_typeof(p_evidence->'bills') is distinct from 'array' or p_evidence->'bills' <> '[]'::jsonb
    or (p_evidence->>'observedAt')::timestamptz > clock_timestamp()
    or (p_evidence->>'startedAt')::timestamptz < clock_timestamp()-interval '2 minutes'
    then raise exception 'DEMO_BASELINE_EVIDENCE_INVALID'; end if;
  if not exists(select 1 from jsonb_array_elements(p_evidence->'balances') b where b->>'currency'=p_baseline->>'quoteCurrency'
      and (b->>'total')::numeric=(p_baseline->>'cash')::numeric and (b->>'available')::numeric=(b->>'total')::numeric)
    or (p_baseline->'openingBalances' is null and exists(select 1 from jsonb_array_elements(p_evidence->'balances') b where b->>'currency'<>p_baseline->>'quoteCurrency' and (b->>'total')::numeric<>0))
    then raise exception 'DEMO_BASELINE_BALANCES_INVALID'; end if;
  if p_baseline->'openingBalances' is not null and (
    p_baseline->>'valuationPolicy' is distinct from 'OBSERVED_BASELINE_NOT_HISTORICAL_COST'
    or p_baseline->'openingBalances' is distinct from p_evidence->'balances'
    or p_baseline->'openingMarks' is distinct from coalesce(p_evidence->'holdingMarks','[]'::jsonb)
    or p_baseline->'openingMark' is distinct from p_evidence->'mark'
    or exists(select 1 from jsonb_array_elements(p_evidence->'balances') b where b->>'currency' is null
      or b->>'total' is null or b->>'available' is null or (b->>'total')::numeric<0
      or (b->>'total')::numeric::text in ('NaN','Infinity','-Infinity')
      or (b->>'total')::numeric is distinct from (b->>'available')::numeric)
    or (select count(*)<>count(distinct b->>'currency') from jsonb_array_elements(p_evidence->'balances') b)
  ) then raise exception 'DEMO_BASELINE_HOLDINGS_INVALID'; end if;
  insert into public.execution_accounts(account_key,provider,provider_environment,status)
    values(p_provider||'-primary',p_provider,'DEMO','PAUSED') on conflict(account_key) do nothing;
  select * into a from public.execution_accounts where account_key=p_provider||'-primary' for update;
  if a.provider is distinct from p_provider or a.provider_environment <> 'DEMO' then raise exception 'DEMO_ACCOUNT_MISMATCH'; end if;
  if a.demo_baseline is not null then
    if a.demo_baseline = p_baseline then return jsonb_build_object('accountId',a.id,'prepared',true,'reused',true); end if;
    raise exception 'DEMO_BASELINE_ALREADY_BOUND';
  end if;
  if exists(select 1 from public.execution_orders where account_id=a.id and
      (provider_order_id is not null or filled_quantity>0 or current_state in('SAFETY_PASSED','SUBMITTING','SUBMITTED','ACKNOWLEDGED','PARTIALLY_FILLED','RECONCILIATION_REQUIRED')))
    or exists(select 1 from public.execution_fills where account_id=a.id)
    then raise exception 'DEMO_BASELINE_REQUIRES_UNUSED_LOCAL_ACCOUNT'; end if;
  update public.execution_accounts set provider_account_id=p_baseline->>'externalAccountId',demo_baseline=p_baseline where id=a.id;
  insert into public.demo_account_captures(account_id,evidence_hash,record) values(a.id,p_baseline->>'evidenceHash',jsonb_build_object('baseline',p_baseline,'evidence',p_evidence));
  return jsonb_build_object('accountId',a.id,'prepared',true,'status',a.status,'tradingControlsChanged',false,'ordersSent',0);
end; $$;

create function public.publish_demo_account_capture(p_account_id uuid,p_revision bigint,p_record jsonb,p_snapshot jsonb,p_fill_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.execution_accounts; capture_id uuid; snapshot_id uuid; observation_id uuid;
  at_time timestamptz := clock_timestamp(); evidence jsonb := p_record->'evidence'; body jsonb; is_known boolean;
begin
  select * into a from public.execution_accounts where id=p_account_id for update;
  if a.id is null or a.provider_environment<>'DEMO' or a.revision is distinct from p_revision or a.demo_baseline is null
    then raise exception 'DEMO_ACCOUNT_REVISION_CHANGED'; end if;
  if p_snapshot->>'accountId' is distinct from a.id::text or p_snapshot->>'version' is distinct from 'account-ledger-v2'
    or p_snapshot->>'baselineAt' is distinct from a.demo_baseline->>'at'
    or p_snapshot->>'cutoffAt' is null or p_snapshot->>'status' is null
    or p_snapshot->>'status' not in ('KNOWN','UNKNOWN')
    or (p_snapshot->>'cutoffAt')::timestamptz > at_time
    or (p_snapshot->>'cutoffAt')::timestamptz < at_time-interval '2 minutes'
    then raise exception 'DEMO_SNAPSHOT_INVALID'; end if;
  is_known := p_snapshot->>'status'='KNOWN';
  if is_known and a.demo_baseline->'openingBalances' is not null
    and p_snapshot->>'pnlScope' is distinct from 'SINCE_OBSERVED_BASELINE_NOT_HISTORICAL_COST'
    then raise exception 'DEMO_BASELINE_VALUATION_SCOPE_REQUIRED'; end if;
  if is_known and (evidence->>'externalAccountId' is distinct from a.provider_account_id
    or evidence->>'instrumentId' is distinct from a.demo_baseline->>'instrumentId'
    or evidence->>'windowStart' is distinct from a.demo_baseline->>'at'
    or evidence->>'complete' is distinct from 'true'
    or p_snapshot->'demoReconciliation'->>'externalAccountId' is distinct from a.provider_account_id
    or p_snapshot->'unknownReasons' is distinct from '[]'::jsonb
    or p_record->>'errorReason' is not null) then raise exception 'DEMO_CAPTURE_NOT_RECONCILED'; end if;
  insert into public.demo_account_captures(account_id,evidence_hash,record)
    values(a.id,p_snapshot->>'resultHash',p_record) on conflict(account_id,evidence_hash) do nothing returning id into capture_id;
  if capture_id is null then select id into capture_id from public.demo_account_captures where account_id=a.id and evidence_hash=p_snapshot->>'resultHash'; end if;
  insert into public.account_state_observations(observation_key,account_id,provider,provider_environment,balances,positions,data_status,unknown_reasons,observed_at,available_at,source_reference,payload_hash)
    values('demo:'||(p_snapshot->>'resultHash'),a.id,a.provider,'DEMO',coalesce(evidence->'balances','[]'::jsonb),'[]',case when is_known then 'KNOWN' else 'UNKNOWN' end,
      p_snapshot->'unknownReasons',(p_snapshot->>'cutoffAt')::timestamptz,at_time,'demo_account_captures:'||capture_id,p_snapshot->>'resultHash')
    on conflict(observation_key) do nothing returning id into observation_id;
  insert into public.risk_ledger_snapshots(snapshot_key,account_id,ledger_version,status,cash_sek,open_positions,realized_pnl_sek,daily_realized_pnl_sek,
    fees_sek,reserved_exposure_sek,gross_exposure_sek,available_cash_sek,unknown_reasons,source_fill_ids,information_cutoff_at,economic_cutoff_at,available_at,result_hash,ledger_payload,evidence_refs,demo_capture_id)
    values(p_snapshot->>'snapshotKey',a.id,'account-ledger-v2',p_snapshot->>'status',(p_snapshot->>'cashSek')::numeric,(p_snapshot->>'openPositions')::integer,
      (p_snapshot->>'realizedPnlSek')::numeric,(p_snapshot->>'dailyRealizedPnlSek')::numeric,(p_snapshot->>'feesSek')::numeric,(p_snapshot->>'reservedBuySek')::numeric,
      (p_snapshot->>'grossExposureSek')::numeric,(p_snapshot->>'availableCashSek')::numeric,p_snapshot->'unknownReasons',p_fill_ids,
      (p_snapshot->>'cutoffAt')::timestamptz,(p_snapshot->>'economicCutoffAt')::timestamptz,at_time,p_snapshot->>'resultHash',p_snapshot,
      jsonb_build_object('captureId',capture_id),capture_id)
    on conflict(snapshot_key) do nothing returning id into snapshot_id;
  return jsonb_build_object('captureId',capture_id,'snapshotId',snapshot_id,'status',p_snapshot->>'status');
end; $$;
revoke all on function public.prepare_demo_account_baseline(text,jsonb,jsonb),public.publish_demo_account_capture(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_demo_account_baseline(text,jsonb,jsonb),public.publish_demo_account_capture(uuid,bigint,jsonb,jsonb,jsonb) to service_role;

create function public.reserve_demo_order_fee() returns trigger language plpgsql set search_path=public as $$
declare risk public.risk_ledger_snapshots; notional numeric; rate numeric;
begin
  if new.provider_environment='DEMO' and new.account_id is not null then
    select * into risk from public.risk_ledger_snapshots where account_id=new.account_id order by information_cutoff_at desc,id desc limit 1;
    if risk.status='KNOWN' and risk.demo_capture_id is not null then
      select quote_amount_sek into notional from public.execution_intents where id=new.intent_id;
      rate := (risk.ledger_payload->'demoReconciliation'->>'feeRate')::numeric;
      if rate>=0 and rate<=0.01 then new.reservation_fee_buffer_sek := notional*rate; end if;
    end if;
  end if;
  return new;
end; $$;
create trigger demo_order_fee_reservation before insert on public.execution_orders for each row execute function public.reserve_demo_order_fee();

-- Same lock order as 0090. Pilot permits one in-flight local order per account,
-- so two distinct workers cannot both spend the same captured free cash.
alter function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) rename to authorize_execution_submission_v2;
revoke all on function public.authorize_execution_submission_v2(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.authorize_execution_submission(p_order_id uuid,p_provider text,p_mode text,p_control_revision bigint,p_account_id uuid,
  p_account_revision bigint,p_risk_snapshot_id uuid,p_account_observation_id uuid,p_safety_evaluation_id uuid,p_check jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.execution_accounts; r public.risk_ledger_snapshots; reason text; answer jsonb; order_state text;
begin
  if p_mode='DEMO' then
    perform 1 from public.execution_controls where control_key='global' for update;
    select * into a from public.execution_accounts where id=p_account_id for update;
    select current_state into order_state from public.execution_orders where id=p_order_id for update;
    if order_state is distinct from 'SAFETY_PASSED' then return jsonb_build_object('authorized',false,'reason','FINAL_ORDER_NOT_READY'); end if;
    select * into r from public.risk_ledger_snapshots where id=p_risk_snapshot_id and account_id=p_account_id;
    if a.demo_baseline is null or a.provider_account_id is null or r.demo_capture_id is null
      or r.ledger_payload->'demoReconciliation'->>'externalAccountId' is distinct from a.provider_account_id
      then reason := 'FINAL_DEMO_ACCOUNT_NOT_RECONCILED';
    elsif exists(select 1 from public.execution_orders where account_id=p_account_id and id<>p_order_id
      and current_state in('SUBMITTING','SUBMITTED','ACKNOWLEDGED','PARTIALLY_FILLED','RECONCILIATION_REQUIRED'))
      then reason := 'FINAL_DEMO_ORDER_IN_FLIGHT';
    elsif exists(select 1 from public.demo_capture_claims where capture_id=r.demo_capture_id)
      then reason := 'FINAL_DEMO_CAPTURE_ALREADY_SPENT';
    end if;
    if reason is not null then
      perform public.deny_execution_submission(p_order_id,reason);
      return jsonb_build_object('authorized',false,'reason',reason,'orderId',p_order_id);
    end if;
  end if;
  answer := public.authorize_execution_submission_v2(p_order_id,p_provider,p_mode,p_control_revision,p_account_id,p_account_revision,
    p_risk_snapshot_id,p_account_observation_id,p_safety_evaluation_id,p_check);
  if p_mode='DEMO' and answer->>'authorized'='true' then
    insert into public.demo_capture_claims(capture_id,order_id) values(r.demo_capture_id,p_order_id);
  end if;
  return answer;
end; $$;
revoke all on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) to service_role;
