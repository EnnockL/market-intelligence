create table public.strategy_validation_protocols (
  id uuid primary key default gen_random_uuid(), protocol_key text not null, version integer not null,
  status text not null check (status in ('ACTIVE','DEPRECATED')), definition jsonb not null,
  definition_hash text not null unique, effective_at timestamptz not null, available_at timestamptz not null,
  created_at timestamptz not null default now(), unique(protocol_key,version), check(effective_at<=available_at)
);

create table public.strategy_hypotheses (
  id uuid primary key default gen_random_uuid(), hypothesis_key text not null unique,
  strategy_definition_id uuid not null references public.strategy_definitions(id), hypothesis_version integer not null,
  thesis text not null, invalidation_condition text not null, expected_mechanism text not null,
  registered_at timestamptz not null, information_cutoff_at timestamptz not null, available_at timestamptz not null,
  evidence_refs jsonb not null default '[]', hypothesis_hash text not null unique, created_at timestamptz not null default now(),
  check(available_at<=information_cutoff_at), unique(strategy_definition_id,hypothesis_version)
);

create table public.strategy_validation_runs (
  id uuid primary key default gen_random_uuid(), validation_key text not null unique,
  protocol_id uuid not null references public.strategy_validation_protocols(id), hypothesis_id uuid not null references public.strategy_hypotheses(id),
  strategy_definition_id uuid not null references public.strategy_definitions(id), phase text not null check(phase in ('LEARNING','FROZEN','OUT_OF_SAMPLE','DEMO_VALIDATION')),
  window_start timestamptz not null, window_end timestamptz not null, information_cutoff_at timestamptz not null, available_at timestamptz not null,
  dataset_hash text not null, input_snapshot_ids jsonb not null, decision text not null check(decision in ('APPROVED','REJECTED','INSUFFICIENT_DATA')),
  gates jsonb not null, metrics jsonb not null, result_hash text not null, created_at timestamptz not null default now(),
  check(window_start<=window_end), check(window_end<=information_cutoff_at), check(available_at<=information_cutoff_at)
);
create index strategy_validation_runs_lookup_idx on public.strategy_validation_runs(strategy_definition_id,phase,information_cutoff_at desc);

create table public.strategy_runtime_assessments (
  id uuid primary key default gen_random_uuid(), assessment_key text not null unique,
  strategy_definition_id uuid not null references public.strategy_definitions(id), validation_run_id uuid references public.strategy_validation_runs(id),
  governance_version text not null, runtime_state text not null check(runtime_state in ('RESEARCH','FROZEN','OUT_OF_SAMPLE','DEMO_VALIDATION','APPROVED_SHADOW','LIVE_LIMITED','LIVE_APPROVED','REVALIDATION_REQUIRED','PAUSED','RETIRED','REJECTED')),
  decision text not null check(decision in ('NO_TRADE','SHADOW_ONLY','LIMITED_ELIGIBLE','LIVE_ELIGIBLE')),
  information_cutoff_at timestamptz not null, available_at timestamptz not null, gates jsonb not null, edge_decay jsonb not null,
  correlation_assessment jsonb not null, risk_diagnostics jsonb not null, revalidation_required boolean not null,
  result_hash text not null, created_at timestamptz not null default now(), check(available_at<=information_cutoff_at)
);
create index strategy_runtime_assessments_lookup_idx on public.strategy_runtime_assessments(strategy_definition_id,information_cutoff_at desc);

create table public.strategy_capital_gate_decisions (
  id uuid primary key default gen_random_uuid(), decision_key text not null unique,
  strategy_definition_id uuid not null references public.strategy_definitions(id), runtime_assessment_id uuid not null references public.strategy_runtime_assessments(id),
  current_capital numeric not null check(current_capital>0), requested_capital numeric not null check(requested_capital>0),
  maximum_allowed numeric not null, decision text not null check(decision in ('APPROVED','NO_CHANGE')),
  manual_approval boolean not null, approved_by text, information_cutoff_at timestamptz not null, available_at timestamptz not null,
  decision_hash text not null, created_at timestamptz not null default now(), check(available_at<=information_cutoff_at),
  check((decision='APPROVED' and manual_approval and approved_by is not null) or decision='NO_CHANGE')
);

insert into public.strategy_validation_protocols(protocol_key,version,status,definition,definition_hash,effective_at,available_at)
values ('strategy-validation-protocol',1,'ACTIVE','{"minimumTrades":30,"minimumDataQuality":80,"minimumIndependentPeriods":2,"minimumRegimes":2,"minimumProfitFactor":1,"maximumDrawdownR":20,"maximumTopTradePnlShare":0.35,"maximumTopAssetPnlShare":0.6,"minimumModeledLiveEvR":0,"minimumStressEvR":0,"confidenceLevel":0.95}'::jsonb,
  encode(digest('strategy-validation-protocol-v1','sha256'),'hex'),'2026-08-26T00:00:00Z','2026-08-26T00:00:00Z')
on conflict(protocol_key,version) do nothing;

create trigger strategy_validation_protocols_immutable before update or delete on public.strategy_validation_protocols for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_hypotheses_immutable before update or delete on public.strategy_hypotheses for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_validation_runs_immutable before update or delete on public.strategy_validation_runs for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_runtime_assessments_immutable before update or delete on public.strategy_runtime_assessments for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_capital_gate_decisions_immutable before update or delete on public.strategy_capital_gate_decisions for each row execute function public.prevent_strategy_lab_mutation();

alter table public.strategy_validation_protocols enable row level security;
alter table public.strategy_hypotheses enable row level security;
alter table public.strategy_validation_runs enable row level security;
alter table public.strategy_runtime_assessments enable row level security;
alter table public.strategy_capital_gate_decisions enable row level security;
create policy "public read validation protocols" on public.strategy_validation_protocols for select using(true);
create policy "public read strategy hypotheses" on public.strategy_hypotheses for select using(true);
create policy "public read strategy validation runs" on public.strategy_validation_runs for select using(true);
create policy "public read runtime assessments" on public.strategy_runtime_assessments for select using(true);
create policy "public read capital gate decisions" on public.strategy_capital_gate_decisions for select using(true);
grant select on public.strategy_validation_protocols,public.strategy_hypotheses,public.strategy_validation_runs,public.strategy_runtime_assessments,public.strategy_capital_gate_decisions to anon,authenticated;
grant all on public.strategy_validation_protocols,public.strategy_hypotheses,public.strategy_validation_runs,public.strategy_runtime_assessments,public.strategy_capital_gate_decisions to service_role;
