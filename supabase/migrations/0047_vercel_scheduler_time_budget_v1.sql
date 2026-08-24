update public.scheduled_jobs
set scheduler_version = 'forecast-scheduler-v1.4', updated_at = now();

update public.scheduled_jobs
set rate_limit_budget = coalesce(rate_limit_budget, '{}'::jsonb) || '{"batchSize":25}'::jsonb,
    lease_seconds = greatest(lease_seconds, 120),
    updated_at = now()
where job_type = 'FORECAST_OUTCOME';
