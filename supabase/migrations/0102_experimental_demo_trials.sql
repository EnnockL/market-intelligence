-- Explicit experimental demo allocation. Never promotes a research strategy.
create table public.demo_trials(
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.execution_accounts(id),
 asset_id uuid not null references public.assets(id), strategy_definition_id uuid not null references public.strategy_definitions(id),
 instrument_id text not null check(instrument_id='BTC-EUR'), enabled boolean not null default false,
 started_at timestamptz not null default clock_timestamp(), ends_at timestamptz not null,
 budget_sek numeric not null default 200 check(budget_sek=200), max_order_sek numeric not null default 100 check(max_order_sek=100),
 label text not null default 'EXPERIMENTAL_UNVALIDATED', check(label='EXPERIMENTAL_UNVALIDATED'),check(ends_at>started_at)
);
create unique index one_demo_trial_account on public.demo_trials(account_id);
create table public.demo_trial_decisions(
 id uuid primary key default gen_random_uuid(),trial_id uuid not null references public.demo_trials(id),signal_key text not null,
 decision text not null check(decision in('WAIT','BUY','SELL')),reason text not null,candle_id uuid references public.market_candles(id),
 evidence jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(trial_id,signal_key)
);
create table public.demo_trial_snapshots(
 id uuid primary key default gen_random_uuid(),trial_id uuid not null references public.demo_trials(id),
 risk_snapshot_id uuid not null references public.risk_ledger_snapshots(id),ledger_payload jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index demo_trial_snapshots_scope on public.demo_trial_snapshots(trial_id,created_at desc);
create unique index demo_trial_one_intent_per_decision on public.execution_intents(source_id) where source_type='demo_trial';
alter table public.demo_trials enable row level security;
alter table public.demo_trial_decisions enable row level security;
alter table public.demo_trial_snapshots enable row level security;
revoke all on public.demo_trials,public.demo_trial_decisions,public.demo_trial_snapshots from public,anon,authenticated,service_role;
grant select on public.demo_trials to service_role;
grant select,insert on public.demo_trial_decisions,public.demo_trial_snapshots to service_role;
create trigger demo_trial_decisions_immutable before update or delete on public.demo_trial_decisions for each row execute function public.prevent_execution_history_mutation();
create trigger demo_trial_snapshots_immutable before update or delete on public.demo_trial_snapshots for each row execute function public.prevent_execution_history_mutation();

-- Keep the existing full-account, single-flight, freshness and provider boundary.
-- Additional trial checks are serialized by the same control/account locks.
alter function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) rename to authorize_execution_submission_pre_trial;
revoke all on function public.authorize_execution_submission_pre_trial(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.authorize_execution_submission(p_order_id uuid,p_provider text,p_mode text,p_control_revision bigint,p_account_id uuid,
 p_account_revision bigint,p_risk_snapshot_id uuid,p_account_observation_id uuid,p_safety_evaluation_id uuid,p_check jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i execution_intents; a execution_accounts; d demo_trial_decisions; t demo_trials; s demo_trial_snapshots;
 r risk_ledger_snapshots; reason text; quantity numeric; reserved numeric:=0; reserved_sell numeric:=0; pos jsonb; item jsonb; full_quantity numeric;
begin
 perform 1 from execution_controls where control_key='global' for update;
 select * into a from execution_accounts where id=p_account_id for update;
 select x.* into i from execution_orders o join execution_intents x on x.id=o.intent_id where o.id=p_order_id;
 if i.source_type='demo_trial' then
   select * into d from demo_trial_decisions where id::text=i.source_id;
   select * into t from demo_trials where id=d.trial_id for update;
   select * into s from demo_trial_snapshots where id::text=p_check->>'trialSnapshotId';
   select * into r from risk_ledger_snapshots where id=p_risk_snapshot_id;
   if p_mode is distinct from 'DEMO' or p_provider is distinct from 'okx-demo' or a.provider_environment is distinct from 'DEMO'
     or t.id is null or t.enabled is distinct from true or t.account_id is distinct from a.id
     or t.asset_id is distinct from i.asset_id or i.instrument_id is distinct from t.instrument_id
     or i.strategy_attribution_id is not null or d.decision is distinct from i.side
     or (i.side='BUY' and t.ends_at<=clock_timestamp()) then reason:='FINAL_DEMO_TRIAL_SCOPE';
   elsif s.trial_id is distinct from t.id or s.risk_snapshot_id is distinct from r.id or s.id is null
     or r.account_id is distinct from a.id or r.status is distinct from 'KNOWN'
     or s.ledger_payload->>'status' is distinct from 'KNOWN' or s.ledger_payload->>'version' is distinct from 'account-ledger-v2'
     or s.ledger_payload->>'accountId' is distinct from a.id::text or s.ledger_payload->'unknownReasons' is distinct from '[]'::jsonb
     or s.ledger_payload ? 'pnlScope' or (s.ledger_payload->>'baselineAt')::timestamptz is distinct from t.started_at
     or (s.ledger_payload->>'cutoffAt')::timestamptz is distinct from r.information_cutoff_at
     or (s.ledger_payload->>'economicCutoffAt')::timestamptz is distinct from r.economic_cutoff_at
     or jsonb_typeof(s.ledger_payload->'pendingOrders') is distinct from 'array'
     or jsonb_typeof(s.ledger_payload->'positions') is distinct from 'array' then reason:='FINAL_DEMO_TRIAL_EVIDENCE';
   elsif i.order_type<>'LIMIT' or i.quantity is null or i.quantity<=0 or i.quote_amount_sek>t.max_order_sek
     or i.quote_amount_sek<10 then reason:='FINAL_DEMO_TRIAL_ORDER_LIMIT';
   else
     for item in select value from jsonb_array_elements(s.ledger_payload->'pendingOrders') loop
       if item->>'orderId'<>p_order_id::text then
         if item->>'side'='BUY' then reserved:=reserved+(item->>'remainingNotionalSek')::numeric;
         else reserved_sell:=reserved_sell+(item->>'remainingQuantity')::numeric; end if;
       end if;
     end loop;
     select value into pos from jsonb_array_elements(s.ledger_payload->'positions') where value->>'instrumentId'=t.instrument_id;
     select (value->>'availableQuantity')::numeric into full_quantity from jsonb_array_elements(r.ledger_payload->'positions') where value->>'instrumentId'=t.instrument_id;
     quantity:=coalesce((pos->>'quantity')::numeric,0)-reserved_sell;
     if i.side='SELL' and (quantity<i.quantity or full_quantity is null or full_quantity<i.quantity) then reason:='FINAL_DEMO_TRIAL_SELL_INVENTORY';
     elsif i.side='BUY' and ((s.ledger_payload->>'grossExposureSek')::numeric is null
       or (s.ledger_payload->>'cashSek')::numeric is null or (s.ledger_payload->>'dailyRealizedPnlSek')::numeric is null
       or coalesce((pos->>'quantity')::numeric,0)>=(r.ledger_payload->'demoReconciliation'->'market'->>'minimumSize')::numeric
       or (s.ledger_payload->>'grossExposureSek')::numeric+reserved+i.quote_amount_sek>t.budget_sek
       or (s.ledger_payload->>'cashSek')::numeric-reserved<i.quote_amount_sek*(1+(r.ledger_payload->'demoReconciliation'->>'feeRate')::numeric)
       or (s.ledger_payload->>'dailyRealizedPnlSek')::numeric<=-100) then reason:='FINAL_DEMO_TRIAL_BUDGET'; end if;
   end if;
   if reason is not null then
     perform deny_execution_submission(p_order_id,reason);
     return jsonb_build_object('authorized',false,'reason',reason,'orderId',p_order_id);
   end if;
 elsif p_check ? 'trialSnapshotId' then
   perform deny_execution_submission(p_order_id,'FINAL_DEMO_TRIAL_SCOPE');
   return jsonb_build_object('authorized',false,'reason','FINAL_DEMO_TRIAL_SCOPE');
 end if;
 return authorize_execution_submission_pre_trial(p_order_id,p_provider,p_mode,p_control_revision,p_account_id,p_account_revision,
 p_risk_snapshot_id,p_account_observation_id,p_safety_evaluation_id,p_check);
end $$;
revoke all on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_execution_submission(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb) to service_role;
create view public.demo_trial_orders with(security_invoker=true) as
 select o.*,to_jsonb(i) execution_intents,d.trial_id,d.created_at action_at from execution_orders o
 join execution_intents i on i.id=o.intent_id and i.source_type='demo_trial'
 join demo_trial_decisions d on d.id::text=i.source_id;
create view public.demo_trial_fills with(security_invoker=true) as
 select f.*,o.trial_id from execution_fills f join demo_trial_orders o on o.id=f.order_id;
revoke all on public.demo_trial_orders,public.demo_trial_fills from public,anon,authenticated;
grant select on public.demo_trial_orders,public.demo_trial_fills to service_role;

update public.scheduled_jobs set lease_seconds=180 where job_key='execution-pipeline-1m';
