-- Operational queue state is mutable; candidate revisions and evaluations
-- remain immutable. A provider fetch is not proof that its data was consumed.
create table public.candidate_data_gap_work (
  candidate_id uuid primary key references public.jackpot_candidates(id),
  status text not null default 'READY' check(status in ('READY','WAITING_EVIDENCE','PARTIAL','COMPLETE','FAILED','CANCELLED')),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  pending_evidence_after timestamptz,
  source_revision integer,
  result_revision integer,
  claim_token uuid,
  leased_until timestamptz,
  errors jsonb not null default '[]'
);
alter table public.candidate_data_gap_work enable row level security;
grant all on public.candidate_data_gap_work to service_role;
create index candidate_data_gap_work_due_idx on public.candidate_data_gap_work(next_attempt_at,leased_until);
create index if not exists jackpot_candidates_gap_due_idx
  on public.jackpot_candidates(detected_at,id)
  where current_state not in ('REJECTED','EXPIRED');

create or replace function public.claim_candidate_data_gaps(
  batch_limit integer default 4, input_cutoff timestamptz default now()
) returns table(candidate_id uuid, claim_token uuid)
language plpgsql volatile security invoker set search_path=public
as $$
begin
  return query
  with selected as materialized (
    select c.id from public.jackpot_candidates c
    left join public.candidate_data_gap_work q on q.candidate_id=c.id
    where c.current_state not in ('REJECTED','EXPIRED')
      and c.detected_at<=input_cutoff and (c.expires_at is null or c.expires_at>input_cutoff)
      and (q.leased_until is null or q.leased_until<=clock_timestamp())
      and (q.next_attempt_at is null or q.next_attempt_at<=input_cutoff)
      and (q.pending_evidence_after is null or q.pending_evidence_after<=input_cutoff)
      and (q.status is distinct from 'COMPLETE' or c.current_revision>coalesce(q.result_revision,0))
    order by coalesce(q.next_attempt_at,c.detected_at),c.detected_at,c.id
    limit greatest(1,least(coalesce(batch_limit,4),20))
    for update of c skip locked
  )
  insert into public.candidate_data_gap_work(candidate_id,last_attempt_at,claim_token,leased_until)
  select s.id,clock_timestamp(),gen_random_uuid(),clock_timestamp()+interval '10 minutes' from selected s
  on conflict on constraint candidate_data_gap_work_pkey do update
    set last_attempt_at=excluded.last_attempt_at,claim_token=excluded.claim_token,leased_until=excluded.leased_until
  returning candidate_data_gap_work.candidate_id,candidate_data_gap_work.claim_token;
end;
$$;

create or replace function public.release_candidate_data_gap(
  target_candidate uuid, target_claim uuid, retry_at timestamptz, failure_errors jsonb
) returns boolean language sql volatile security invoker set search_path=public
as $$
  with released as (
    update public.candidate_data_gap_work set status='FAILED',next_attempt_at=retry_at,
      errors=coalesce(failure_errors,'[]'::jsonb),claim_token=null,leased_until=null
    where candidate_id=target_candidate and claim_token=target_claim
    returning candidate_id
  ) select exists(select 1 from released);
$$;

-- Revision, evaluation and queue progress commit together. Event collector
-- races produce a retry, never an orphan revision or a stale pointer update.
create or replace function public.finish_candidate_data_gap(
  target_candidate uuid, target_claim uuid, expected_revision integer,
  input_cutoff timestamptz, closure jsonb, retry_at timestamptz,
  waiting_after timestamptz default null
) returns table(created boolean, result_revision integer, work_status text)
language plpgsql volatile security invoker set search_path=public
as $$
declare
  candidate public.jackpot_candidates%rowtype;
  source public.jackpot_candidate_revisions%rowtype;
  previous public.candidate_data_gap_evaluations%rowtype;
  revision_number integer;
  next_status text;
  safety text;
begin
  select * into candidate from public.jackpot_candidates where id=target_candidate for update;
  if not found then raise exception 'DATA_GAP_CANDIDATE_MISSING'; end if;
  perform 1 from public.candidate_data_gap_work where candidate_id=target_candidate
    and claim_token=target_claim and leased_until>clock_timestamp() for update;
  if not found then return query select false,null::integer,'LEASE_LOST'::text; return; end if;
  if candidate.current_state in ('REJECTED','EXPIRED') or candidate.expires_at<=greatest(input_cutoff,clock_timestamp()) then
    update public.candidate_data_gap_work set status='CANCELLED',claim_token=null,leased_until=null,
      errors='["CANDIDATE_NO_LONGER_ACTIVE"]'::jsonb where candidate_id=target_candidate;
    return query select false,candidate.current_revision,'CANCELLED'::text; return;
  end if;
  if candidate.current_revision<>expected_revision then
    update public.candidate_data_gap_work set status='READY',next_attempt_at=input_cutoff,
      claim_token=null,leased_until=null where candidate_id=target_candidate;
    return query select false,candidate.current_revision,'REVISION_CHANGED'::text; return;
  end if;
  select * into source from public.jackpot_candidate_revisions r
    where r.candidate_id=target_candidate and r.revision_number=expected_revision
      and r.information_cutoff_at<=input_cutoff and r.available_at<=input_cutoff;
  if not found then raise exception 'DATA_GAP_SOURCE_NOT_AVAILABLE_AT_CUTOFF'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(closure->'evidence','[]'::jsonb)) e
    where (e->>'availableAt')::timestamptz>input_cutoff) then
    raise exception 'FUTURE_EVIDENCE_REJECTED';
  end if;
  safety := case when closure->'features'->>'riskStatus' in ('CONFIRMED_RUG','HIGH_RISK') then 'FAIL'
    when closure->'features'->>'riskStatus' in ('LOW_RISK','ELEVATED') then 'PASS' else 'UNKNOWN' end;
  next_status := case when waiting_after>input_cutoff then 'WAITING_EVIDENCE'
    when safety<>'UNKNOWN' and not exists(select 1 from jsonb_each_text(closure->'gaps') g where g.value<>'CLOSED') then 'COMPLETE'
    else 'PARTIAL' end;
  select * into previous from public.candidate_data_gap_evaluations where closure_hash=closure->>'closureHash';
  if found then
    update public.candidate_data_gap_work set status=next_status,next_attempt_at=retry_at,
      pending_evidence_after=waiting_after,source_revision=expected_revision,
      result_revision=candidate.current_revision,errors=coalesce(closure->'errors','[]'::jsonb),claim_token=null,leased_until=null
      where candidate_id=target_candidate;
    return query select false,candidate.current_revision,next_status; return;
  end if;
  revision_number := expected_revision+1;
  insert into public.jackpot_candidate_revisions(candidate_id,revision_number,revision_type,state,trigger_event_id,
    information_cutoff_at,available_at,features,probability_features,payoff_features,safety_result,evidence_refs,revision_hash)
  values(target_candidate,revision_number,'v3_risk_liquidity',candidate.current_state,null,
    input_cutoff,greatest(input_cutoff,clock_timestamp()),closure->'features',source.probability_features,
    source.payoff_features||jsonb_build_object('liquidity',closure->'features'->'liquidity','tokenAgeSeconds',closure->'features'->'tokenAgeSeconds'),
    jsonb_build_object('status',safety,'riskStatus',closure->'features'->>'riskStatus'),closure->'evidence',closure->>'closureHash');
  update public.jackpot_candidates set current_revision=revision_number where id=target_candidate;
  insert into public.candidate_data_gap_evaluations(candidate_id,source_revision,result_revision,candidate_cutoff_at,
    evaluated_at,closure_version,gap_statuses,evidence_refs,provider_errors,closure_hash)
  values(target_candidate,expected_revision,revision_number,source.information_cutoff_at,input_cutoff,
    closure->>'version',closure->'gaps',closure->'evidence',coalesce(closure->'errors','[]'::jsonb),closure->>'closureHash');
  update public.candidate_data_gap_work set status=next_status,next_attempt_at=retry_at,pending_evidence_after=waiting_after,
    source_revision=expected_revision,result_revision=revision_number,errors=coalesce(closure->'errors','[]'::jsonb),
    claim_token=null,leased_until=null where candidate_id=target_candidate;
  return query select true,revision_number,next_status;
end;
$$;

revoke all on table public.candidate_data_gap_work from anon,authenticated;
revoke all on function public.claim_candidate_data_gaps(integer,timestamptz) from public,anon,authenticated;
revoke all on function public.release_candidate_data_gap(uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.finish_candidate_data_gap(uuid,uuid,integer,timestamptz,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_candidate_data_gaps(integer,timestamptz) to service_role;
grant execute on function public.release_candidate_data_gap(uuid,uuid,timestamptz,jsonb) to service_role;
grant execute on function public.finish_candidate_data_gap(uuid,uuid,integer,timestamptz,jsonb,timestamptz,timestamptz) to service_role;
