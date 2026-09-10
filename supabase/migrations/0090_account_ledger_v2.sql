-- Explicit evidence boundaries only. Existing account cash is not a declaration
-- of opening inventory/funding, and legacy snapshots are never upgraded in place.
alter table public.execution_accounts
  add column ledger_baseline_at timestamptz,
  add column ledger_opening_status text not null default 'UNKNOWN'
    check(ledger_opening_status in ('UNKNOWN','DECLARED')),
  add column ledger_history_verified_through timestamptz,
  add column ledger_history_reference text;
alter table public.execution_orders
  add column reservation_fee_buffer_sek numeric
    check(reservation_fee_buffer_sek is null or (reservation_fee_buffer_sek>=0
      and reservation_fee_buffer_sek::text not in ('NaN','Infinity','-Infinity')));
alter table public.risk_ledger_snapshots
  add column daily_realized_pnl_sek numeric,
  add column gross_exposure_sek numeric,
  add column available_cash_sek numeric,
  add column economic_cutoff_at timestamptz,
  add column ledger_payload jsonb,
  add column evidence_refs jsonb;
alter table public.risk_ledger_snapshots add constraint account_ledger_v2_known_values check (
  ledger_version<>'account-ledger-v2' or status<>'KNOWN' or (
    cash_sek is not null and open_positions is not null and open_positions>=0
    and realized_pnl_sek is not null and daily_realized_pnl_sek is not null
    and fees_sek is not null and reserved_exposure_sek is not null and reserved_exposure_sek>=0
    and gross_exposure_sek is not null and gross_exposure_sek>=0 and available_cash_sek is not null
    and cash_sek::text not in ('NaN','Infinity','-Infinity')
    and realized_pnl_sek::text not in ('NaN','Infinity','-Infinity')
    and daily_realized_pnl_sek::text not in ('NaN','Infinity','-Infinity')
    and fees_sek::text not in ('NaN','Infinity','-Infinity')
    and reserved_exposure_sek::text not in ('NaN','Infinity','-Infinity')
    and gross_exposure_sek::text not in ('NaN','Infinity','-Infinity')
    and available_cash_sek::text not in ('NaN','Infinity','-Infinity')
    and economic_cutoff_at is not null and economic_cutoff_at<=information_cutoff_at
  )
);
comment on column public.risk_ledger_snapshots.open_quantity is 'Legacy scalar only. V2 holds quantities per instrument in ledger_payload.positions; null is expected.';
comment on column public.risk_ledger_snapshots.average_cost_sek is 'Legacy scalar only. V2 holds cost basis per instrument; null is expected.';
comment on column public.execution_accounts.ledger_history_reference is 'Explicit reference proving the declared account history boundary, not inferred from partial fills or account balance.';

create or replace function public.authorize_execution_submission(
  p_order_id uuid,
  p_provider text,
  p_mode text,
  p_control_revision bigint,
  p_account_id uuid,
  p_account_revision bigint,
  p_risk_snapshot_id uuid,
  p_account_observation_id uuid,
  p_safety_evaluation_id uuid,
  p_check jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.execution_controls;
  a public.execution_accounts;
  o public.execution_orders;
  i public.execution_intents;
  risk public.risk_ledger_snapshots;
  observation public.account_state_observations;
  current_at timestamptz := clock_timestamp();
  reason text;
  target_state text;
  max_age_ms numeric;
begin
  -- Preserve 0087's lock order and single-claim semantics.
  select * into c from public.execution_controls where control_key = 'global' for update;
  select * into a from public.execution_accounts where id = p_account_id for update;
  select * into o from public.execution_orders where id = p_order_id for update;
  if o.id is null or o.current_state <> 'SAFETY_PASSED' then
    return jsonb_build_object('authorized', false, 'reason', 'FINAL_ORDER_NOT_READY');
  end if;
  current_at := clock_timestamp();
  select * into i from public.execution_intents where id = o.intent_id;
  -- Select latest BEFORE testing status/version: new UNKNOWN or legacy records
  -- cannot expose an older apparently eligible KNOWN balance.
  select * into risk from public.risk_ledger_snapshots
    where account_id = a.id and available_at <= current_at
    order by information_cutoff_at desc, id desc limit 1;
  select * into observation from public.account_state_observations
    where account_id = a.id and available_at <= current_at
    order by observed_at desc, id desc limit 1;

  if o.provider_order_id is not null then reason := 'FINAL_PROVIDER_ORDER_ALREADY_EXISTS';
  elsif c.control_key is null then reason := 'FINAL_CONTROL_UNKNOWN';
  elsif c.kill_switch is distinct from false then reason := 'FINAL_KILL_SWITCH_ACTIVE';
  elsif c.new_orders_enabled is distinct from true then reason := 'FINAL_NEW_ORDERS_DISABLED';
  elsif c.live_execution_enabled is distinct from false then reason := 'FINAL_LIVE_EXECUTION_FORBIDDEN';
  elsif p_mode is null or p_mode not in ('SHADOW', 'DEMO') or c.mode is distinct from p_mode
    or c.provider is distinct from p_provider or o.provider is distinct from p_provider
    or o.provider_environment is distinct from p_mode then reason := 'FINAL_PROVIDER_MODE_MISMATCH';
  elsif c.provider_status <> 'HEALTHY' then reason := 'FINAL_PROVIDER_UNAVAILABLE';
  elsif c.revision is distinct from p_control_revision then reason := 'FINAL_CONTROL_REVISION_CHANGED';
  elsif a.id is null then reason := 'FINAL_ACCOUNT_UNKNOWN';
  elsif a.status <> 'ACTIVE' then reason := 'FINAL_ACCOUNT_PAUSED';
  elsif a.provider is distinct from p_provider or a.provider_environment is distinct from p_mode
    or a.account_key is distinct from (case when p_mode = 'SHADOW' then 'shadow-primary' else p_provider || '-primary' end)
    or o.account_id is distinct from a.id then reason := 'FINAL_ACCOUNT_MISMATCH';
  elsif a.revision is distinct from p_account_revision then reason := 'FINAL_ACCOUNT_REVISION_CHANGED';
  elsif i.id is null or i.expires_at <= current_at then reason := 'FINAL_INTENT_EXPIRED';
  elsif o.safety_evaluation_id is distinct from p_safety_evaluation_id or not exists (
    select 1 from public.execution_safety_evaluations s where s.id = p_safety_evaluation_id
      and s.intent_id = o.intent_id and s.decision = 'PASSED'
      and s.policy_version = 'execution-safety-policy-v1' and s.available_at <= current_at
  ) then reason := 'FINAL_SAFETY_EVIDENCE_UNKNOWN';
  elsif risk.id is null or risk.status <> 'KNOWN' or risk.id is distinct from p_risk_snapshot_id then reason := 'FINAL_RISK_REVISION_CHANGED_OR_UNKNOWN';
  elsif risk.ledger_version is distinct from 'account-ledger-v2'
    or jsonb_typeof(risk.ledger_payload) is distinct from 'object'
    or risk.ledger_payload->>'version' is distinct from 'account-ledger-v2'
    or risk.ledger_payload->>'status' is distinct from 'KNOWN'
    or risk.ledger_payload->>'accountId' is distinct from a.id::text
    or risk.unknown_reasons is distinct from '[]'::jsonb
    or risk.ledger_payload->'unknownReasons' is distinct from '[]'::jsonb
    or risk.ledger_payload->>'snapshotKey' is distinct from risk.snapshot_key
    or risk.ledger_payload->>'resultHash' is distinct from risk.result_hash then reason := 'FINAL_RISK_LEDGER_CONTRACT_INVALID';
  elsif observation.id is null or observation.id is distinct from p_account_observation_id
    or observation.provider is distinct from p_provider or observation.provider_environment is distinct from p_mode
    or (p_mode = 'DEMO' and observation.data_status <> 'KNOWN') then reason := 'FINAL_ACCOUNT_OBSERVATION_CHANGED_OR_UNKNOWN';
  elsif p_check is null or p_check->>'decision' is distinct from 'PASSED'
    or p_check->>'guardVersion' is distinct from 'execution-submission-guard-v1'
    or p_check->>'policyVersion' is distinct from 'execution-safety-policy-v1'
    or jsonb_typeof(p_check->'requirements') is distinct from 'array' then reason := 'FINAL_CHECK_UNKNOWN';
  elsif jsonb_array_length(p_check->'requirements') = 0 or exists (
    select 1 from jsonb_array_elements(p_check->'requirements') requirement
    where requirement->>'status' is distinct from 'PASS'
  ) then reason := 'FINAL_CHECK_UNKNOWN';
  else
    -- Cast errors abort authorization; no provider call follows an RPC error.
    max_age_ms := (c.limits->>'maxDataAgeMs')::numeric;
    if max_age_ms is null or max_age_ms <= 0
      or p_check->>'checkedAt' is null or p_check->>'dataAgeMs' is null
      or (p_check->>'dataAgeMs')::numeric < 0
      or (p_check->>'dataAgeMs')::numeric + greatest(0, extract(epoch from (current_at - (p_check->>'checkedAt')::timestamptz)) * 1000) > max_age_ms
      or risk.information_cutoff_at > current_at or observation.observed_at > current_at
      or extract(epoch from (current_at - risk.information_cutoff_at)) * 1000 > max_age_ms
      or extract(epoch from (current_at - observation.observed_at)) * 1000 > max_age_ms
      or risk.economic_cutoff_at is null or risk.economic_cutoff_at > current_at
      or risk.economic_cutoff_at > risk.information_cutoff_at
      or extract(epoch from (current_at - risk.economic_cutoff_at)) * 1000 > max_age_ms
      or (risk.ledger_payload->>'cutoffAt')::timestamptz is distinct from risk.information_cutoff_at
      or (risk.ledger_payload->>'economicCutoffAt')::timestamptz is distinct from risk.economic_cutoff_at then
      reason := 'FINAL_DATA_STALE_OR_UNKNOWN';
    end if;
  end if;

  target_state := case when reason is null then 'SUBMITTING' when reason = 'FINAL_INTENT_EXPIRED' then 'EXPIRED' when reason = 'FINAL_PROVIDER_ORDER_ALREADY_EXISTS' then 'RECONCILIATION_REQUIRED' else 'BLOCKED' end;
  update public.execution_orders set current_state = target_state, updated_at = current_at where id = o.id;
  insert into public.execution_order_events(event_key, order_id, previous_state, next_state, reason, payload, occurred_at, available_at)
  values ('final_' || md5(o.id::text || current_at::text), o.id, 'SAFETY_PASSED', target_state,
    coalesce(reason, 'FINAL_SUBMISSION_SAFETY_PASSED'),
    jsonb_build_object('guardVersion', 'execution-submission-guard-v1', 'controlRevision', c.revision,
      'accountId', a.id, 'accountRevision', a.revision, 'riskSnapshotId', risk.id,
      'accountObservationId', observation.id, 'check', p_check), current_at, current_at);
  return jsonb_build_object('authorized', reason is null, 'reason', coalesce(reason, 'FINAL_SUBMISSION_SAFETY_PASSED'),
    'orderId', o.id, 'state', target_state);
end; $$;

revoke all on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) to service_role;
