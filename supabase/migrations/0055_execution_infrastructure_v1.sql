create table public.execution_controls(
  control_key text primary key default 'global' check(control_key='global'), mode text not null check(mode in('SHADOW','DEMO')),
  new_orders_enabled boolean not null default true, kill_switch boolean not null default false,
  live_execution_enabled boolean not null default false check(live_execution_enabled=false), provider text not null,
  provider_status text not null check(provider_status in('HEALTHY','DEGRADED','FAILED','UNKNOWN')),
  limits jsonb not null, updated_at timestamptz not null default now()
);
create table public.execution_control_revisions(
  id uuid primary key default gen_random_uuid(), revision_key text not null unique, control_key text not null references public.execution_controls(control_key),
  mode text not null, new_orders_enabled boolean not null, kill_switch boolean not null, live_execution_enabled boolean not null check(live_execution_enabled=false),
  provider text not null, provider_status text not null, limits jsonb not null, reason text not null, available_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.execution_intents(
  id uuid primary key default gen_random_uuid(), intent_key text not null unique, contract_version text not null,
  source_type text not null, source_id text not null, asset_id uuid not null references public.assets(id), instrument_id text not null,
  side text not null check(side in('BUY','SELL')), order_type text not null check(order_type in('MARKET','LIMIT')),
  quote_amount_sek numeric not null check(quote_amount_sek>0), quantity numeric, limit_price numeric, stop_price numeric, target_price numeric,
  max_slippage_bps integer not null check(max_slippage_bps>=0), information_cutoff_at timestamptz not null, available_at timestamptz not null,
  expires_at timestamptz not null, evidence_refs jsonb not null, consensus_version text, forecast_version text, risk_version text,
  payload_hash text not null, created_at timestamptz not null default now(), check(available_at<=information_cutoff_at),check(information_cutoff_at<expires_at)
);
create table public.execution_safety_evaluations(
  id uuid primary key default gen_random_uuid(), evaluation_key text not null unique, intent_id uuid not null references public.execution_intents(id),
  policy_version text not null, decision text not null check(decision in('PASSED','BLOCKED')), requirements jsonb not null,
  context jsonb not null, limits jsonb not null, result_hash text not null, information_cutoff_at timestamptz not null, available_at timestamptz not null,
  created_at timestamptz not null default now(), check(information_cutoff_at<=available_at)
);
create table public.execution_orders(
  id uuid primary key default gen_random_uuid(), intent_id uuid not null unique references public.execution_intents(id), safety_evaluation_id uuid not null references public.execution_safety_evaluations(id),
  provider text not null, provider_environment text not null check(provider_environment in('SHADOW','DEMO')), client_order_id text not null unique,
  provider_order_id text, current_state text not null, filled_quantity numeric not null default 0, average_price numeric,
  last_provider_observed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.execution_order_events(
  id uuid primary key default gen_random_uuid(), event_key text not null unique, order_id uuid not null references public.execution_orders(id),
  previous_state text, next_state text not null, reason text not null, provider_reference text, payload jsonb not null,
  occurred_at timestamptz not null, available_at timestamptz not null, created_at timestamptz not null default now(),check(occurred_at<=available_at)
);
create table public.execution_fills(
  id uuid primary key default gen_random_uuid(), fill_key text not null unique, order_id uuid not null references public.execution_orders(id),
  provider_fill_id text not null, quantity numeric not null, price numeric not null, fee_amount numeric, fee_currency text,
  occurred_at timestamptz not null, available_at timestamptz not null, payload_hash text not null, created_at timestamptz not null default now()
);
create table public.execution_reconciliation_runs(
  id uuid primary key default gen_random_uuid(), run_key text not null unique, provider text not null, provider_environment text not null,
  started_at timestamptz not null, finished_at timestamptz not null, orders_checked integer not null, mismatches integer not null,
  recovered integer not null, status text not null check(status in('SUCCEEDED','DEGRADED','FAILED')), error_message text, details jsonb not null,
  created_at timestamptz not null default now()
);
create index execution_intents_cutoff_idx on public.execution_intents(information_cutoff_at desc);
create index execution_order_events_timeline_idx on public.execution_order_events(order_id,occurred_at,id);
create index execution_orders_state_idx on public.execution_orders(current_state,updated_at);

create or replace function public.prevent_execution_history_mutation()returns trigger language plpgsql as $$begin raise exception 'execution history is immutable';end;$$;
create trigger execution_intents_immutable before update or delete on public.execution_intents for each row execute function public.prevent_execution_history_mutation();
create trigger execution_safety_immutable before update or delete on public.execution_safety_evaluations for each row execute function public.prevent_execution_history_mutation();
create trigger execution_events_immutable before update or delete on public.execution_order_events for each row execute function public.prevent_execution_history_mutation();
create trigger execution_fills_immutable before update or delete on public.execution_fills for each row execute function public.prevent_execution_history_mutation();
create trigger execution_reconciliation_immutable before update or delete on public.execution_reconciliation_runs for each row execute function public.prevent_execution_history_mutation();

insert into public.execution_controls(control_key,mode,new_orders_enabled,kill_switch,live_execution_enabled,provider,provider_status,limits)
values('global','SHADOW',true,false,false,'shadow-execution','HEALTHY','{"minOrderSek":10,"maxOrderSek":100,"maxOpenPositions":1,"maxDailyLossSek":100,"maxTotalExposureSek":200,"maxDataAgeMs":15000,"maxSlippageBps":50}') on conflict(control_key)do nothing;

alter table public.execution_controls enable row level security;alter table public.execution_control_revisions enable row level security;alter table public.execution_intents enable row level security;alter table public.execution_safety_evaluations enable row level security;alter table public.execution_orders enable row level security;alter table public.execution_order_events enable row level security;alter table public.execution_fills enable row level security;alter table public.execution_reconciliation_runs enable row level security;
create policy "public read execution controls" on public.execution_controls for select using(true);create policy "public read execution revisions" on public.execution_control_revisions for select using(true);create policy "public read execution intents" on public.execution_intents for select using(true);create policy "public read execution safety" on public.execution_safety_evaluations for select using(true);create policy "public read execution orders" on public.execution_orders for select using(true);create policy "public read execution events" on public.execution_order_events for select using(true);create policy "public read execution fills" on public.execution_fills for select using(true);create policy "public read execution reconciliation" on public.execution_reconciliation_runs for select using(true);
grant select on public.execution_controls,public.execution_control_revisions,public.execution_intents,public.execution_safety_evaluations,public.execution_orders,public.execution_order_events,public.execution_fills,public.execution_reconciliation_runs to anon,authenticated;
grant all on public.execution_controls,public.execution_control_revisions,public.execution_intents,public.execution_safety_evaluations,public.execution_orders,public.execution_order_events,public.execution_fills,public.execution_reconciliation_runs to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge','baseline_forecast','forecast_performance','forecast_scheduler','forecast_outcomes','specialist_agents','news_ingestion','catalyst_classification','consensus','agent_performance','market_regime','meta_agent','meta_readiness','strategy_pattern_lab','candle_ingestion','ai_explanations','strategy_intelligence','execution'));
