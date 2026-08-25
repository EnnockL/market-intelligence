update public.scheduled_jobs set priority=110,scheduler_version='forecast-scheduler-v1.2' where job_type='BASELINE_FORECAST';
