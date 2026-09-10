-- Final dispatch authorization, not a new execution capability. Live remains
-- forbidden by 0055. Missing this migration makes the worker fail closed.
alter table public.execution_controls add column if not exists revision bigint not null default 1;
alter table public.execution_accounts add column if not exists revision bigint not null default 1;

create or replace function public.bump_execution_guard_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create trigger execution_control_guard_revision before update on public.execution_controls
for each row execute function public.bump_execution_guard_revision();
create trigger execution_account_guard_revision before update on public.execution_accounts
for each row execute function public.bump_execution_guard_revision();

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
  -- Fixed lock order. Concurrent claimants cannot authorize the same order.
  select * into c from public.execution_controls where control_key = 'global' for update;
  select * into a from public.execution_accounts where id = p_account_id for update;
  select * into o from public.execution_orders where id = p_order_id for update;
  if o.id is null or o.current_state <> 'SAFETY_PASSED' then
    return jsonb_build_object('authorized', false, 'reason', 'FINAL_ORDER_NOT_READY');
  end if;
  current_at := clock_timestamp();
  select * into i from public.execution_intents where id = o.intent_id;
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
    or a.account_key is distinct from (case when p_mode = 'SHADOW' then 'shadow-primary' else p_provider || '-primary' end) then reason := 'FINAL_ACCOUNT_MISMATCH';
  elsif a.revision is distinct from p_account_revision then reason := 'FINAL_ACCOUNT_REVISION_CHANGED';
  elsif i.id is null or i.expires_at <= current_at then reason := 'FINAL_INTENT_EXPIRED';
  elsif o.safety_evaluation_id is distinct from p_safety_evaluation_id or not exists (
    select 1 from public.execution_safety_evaluations s where s.id = p_safety_evaluation_id
      and s.intent_id = o.intent_id and s.decision = 'PASSED'
      and s.policy_version = 'execution-safety-policy-v1' and s.available_at <= current_at
  ) then reason := 'FINAL_SAFETY_EVIDENCE_UNKNOWN';
  elsif risk.id is null or risk.status <> 'KNOWN' or risk.id is distinct from p_risk_snapshot_id then reason := 'FINAL_RISK_REVISION_CHANGED_OR_UNKNOWN';
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
    -- Cast errors abort the transaction; the worker never calls the provider
    -- after an RPC failure. Recheck elapsed freshness at the claim boundary.
    max_age_ms := (c.limits->>'maxDataAgeMs')::numeric;
    if max_age_ms is null or max_age_ms <= 0
      or p_check->>'checkedAt' is null or p_check->>'dataAgeMs' is null
      or (p_check->>'dataAgeMs')::numeric < 0
      or (p_check->>'dataAgeMs')::numeric + greatest(0, extract(epoch from (current_at - (p_check->>'checkedAt')::timestamptz)) * 1000) > max_age_ms
      or risk.information_cutoff_at > current_at or observation.observed_at > current_at
      or extract(epoch from (current_at - risk.information_cutoff_at)) * 1000 > max_age_ms
      or extract(epoch from (current_at - observation.observed_at)) * 1000 > max_age_ms then
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
revoke all on function public.bump_execution_guard_revision() from public,anon,authenticated;

create or replace function public.deny_execution_submission(p_order_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.execution_orders;
  target_state text;
  current_at timestamptz;
begin
  if p_reason is null or p_reason !~ '^FINAL_[A-Z_]+$' then raise exception 'Invalid final guard reason'; end if;
  select * into o from public.execution_orders where id=p_order_id for update;
  if o.id is null or o.current_state<>'SAFETY_PASSED' then return jsonb_build_object('blocked',false,'reason','FINAL_ORDER_NOT_READY'); end if;
  current_at:=clock_timestamp();
  target_state:=case when p_reason='FINAL_INTENT_EXPIRED' then 'EXPIRED' when p_reason='FINAL_PROVIDER_ORDER_ALREADY_EXISTS' then 'RECONCILIATION_REQUIRED' else 'BLOCKED' end;
  update public.execution_orders set current_state=target_state,updated_at=current_at where id=o.id;
  insert into public.execution_order_events(event_key,order_id,previous_state,next_state,reason,payload,occurred_at,available_at)
  values('final_deny_'||md5(o.id::text||current_at::text),o.id,'SAFETY_PASSED',target_state,p_reason,
    jsonb_build_object('guardVersion','execution-submission-guard-v1'),current_at,current_at);
  return jsonb_build_object('blocked',true,'orderId',o.id,'state',target_state);
end; $$;
revoke all on function public.deny_execution_submission(uuid,text) from public,anon,authenticated;
grant execute on function public.deny_execution_submission(uuid,text) to service_role;
