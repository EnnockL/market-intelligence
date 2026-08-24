create or replace function public.claim_forecast_scheduled_job(p_worker_id text,p_now timestamptz default now())returns setof public.scheduled_job_runs language plpgsql security definer set search_path=public as $$
declare j public.scheduled_jobs;r public.scheduled_job_runs;slot timestamptz;next_attempt integer;
begin
  select*into j from scheduled_jobs where enabled and status<>'PAUSED' and next_run_at<=p_now and(locked_at is null or locked_at+(lease_seconds||' seconds')::interval<p_now) order by priority,next_run_at,job_key for update skip locked limit 1;
  if not found then return;end if;
  slot=j.next_run_at;
  select coalesce(max(attempt),0)+1 into next_attempt from scheduled_job_runs where job_id=j.id and scheduled_for=slot;
  update scheduled_jobs set locked_at=p_now,locked_by=p_worker_id,last_started_at=p_now,last_heartbeat_at=p_now,updated_at=p_now where id=j.id;
  insert into scheduled_job_runs(job_id,scheduled_for,status,attempt,worker_id)values(j.id,slot,'RUNNING',next_attempt,p_worker_id)returning*into r;
  return next r;
end$$;
revoke all on function public.claim_forecast_scheduled_job(text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_forecast_scheduled_job(text,timestamptz) to service_role;
