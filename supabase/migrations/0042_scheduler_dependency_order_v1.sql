alter table public.scheduled_jobs add column priority integer not null default 100 check(priority between 1 and 1000);
update public.scheduled_jobs set priority=case job_type
  when 'NEWS_INGESTION' then 10 when 'CATALYST_CLASSIFICATION' then 20 when 'SPECIALIST_AGENTS' then 30
  when 'BASELINE_FORECAST' then 35 when 'MARKET_REGIME' then 40 when 'CONSENSUS' then 50
  when 'FORECAST_OUTCOME' then 60 when 'AGENT_PERFORMANCE' then 70 when 'FORECAST_PERFORMANCE' then 80
  when 'META_AGENT' then 90 when 'META_READINESS' then 100 else 200 end;
alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in('BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority)
values('specialist-agents-5m','SPECIALIST_AGENTS','forecast-scheduler-v1.2',300,600,'HEALTHY',now(),'{}',30) on conflict(job_key)do update set priority=excluded.priority,scheduler_version=excluded.scheduler_version;
create or replace function public.claim_forecast_scheduled_job(p_worker_id text,p_now timestamptz default now())returns setof public.scheduled_job_runs language plpgsql security definer set search_path=public as $$declare j public.scheduled_jobs;r public.scheduled_job_runs;slot timestamptz;begin select*into j from scheduled_jobs where enabled and status<>'PAUSED' and next_run_at<=p_now and(locked_at is null or locked_at+(lease_seconds||' seconds')::interval<p_now)order by priority,next_run_at,job_key for update skip locked limit 1;if not found then return;end if;slot=j.next_run_at;update scheduled_jobs set locked_at=p_now,locked_by=p_worker_id,last_started_at=p_now,last_heartbeat_at=p_now,updated_at=p_now where id=j.id;insert into scheduled_job_runs(job_id,scheduled_for,status,attempt,worker_id)values(j.id,slot,'RUNNING',j.consecutive_failures+1,p_worker_id)returning*into r;return next r;end$$;
revoke all on function public.claim_forecast_scheduled_job(text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_forecast_scheduled_job(text,timestamptz) to service_role;
