-- Private execution/account state is served only by authenticated operator
-- server code. Supabase's generic authenticated role is NOT an operator role.
-- Scheduler metrics and raw provider errors can contain account information or
-- provider request details, so public operational UI must use an allowlisted DTO.
-- This migration does not change execution mode, enable jobs, or place orders.
do $$
declare
  private_table text;
  existing_policy record;
begin
  foreach private_table in array array[
    'execution_controls',
    'execution_control_revisions',
    'execution_intents',
    'execution_safety_evaluations',
    'execution_orders',
    'execution_order_events',
    'execution_fills',
    'execution_reconciliation_runs',
    'execution_accounts',
    'account_state_observations',
    'risk_ledger_snapshots',
    'execution_bridge_attempts',
    'trade_proposals',
    'trade_eligibility_evaluations',
    'trade_proposal_producer_evaluations',
    'scheduled_jobs',
    'scheduled_job_runs',
    'ingestion_runs',
    'provider_errors'
  ] loop
    execute format('alter table public.%I enable row level security', private_table);
    for existing_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = private_table
        and roles && array['public', 'anon', 'authenticated']::name[]
    loop
      execute format('drop policy %I on public.%I', existing_policy.policyname, private_table);
    end loop;
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', private_table);
    execute format('grant all privileges on table public.%I to service_role', private_table);
  end loop;
end $$;
