update public.scheduled_jobs set priority=60 where job_type='AGENT_PERFORMANCE';
update public.scheduled_jobs set priority=70 where job_type='META_AGENT';
update public.scheduled_jobs set priority=80 where job_type='META_READINESS';
update public.scheduled_jobs set priority=90 where job_type='FORECAST_OUTCOME';
update public.scheduled_jobs set priority=100 where job_type='FORECAST_PERFORMANCE';
