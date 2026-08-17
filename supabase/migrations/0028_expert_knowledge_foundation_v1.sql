create table public.knowledge_sources(
 id uuid primary key default gen_random_uuid(), source_key text not null unique, title text not null, publisher text not null,
 source_url text not null, source_type text not null, evidence_level text not null check(evidence_level in('ACADEMIC','REGULATORY','ACCOUNTING_STANDARD','EMPIRICAL_SYSTEM','EXPERT_HEURISTIC')),
 published_at timestamptz, accessed_at timestamptz not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.knowledge_rules(
 id uuid primary key default gen_random_uuid(), rule_key text not null, version integer not null check(version>0), domain text not null, topic text not null,
 principle text not null, knowledge_type text not null check(knowledge_type in('FOUNDATION','PROFESSIONAL','SYSTEM_LEARNED')),
 evidence_level text not null check(evidence_level in('ACADEMIC','REGULATORY','ACCOUNTING_STANDARD','EMPIRICAL_SYSTEM','EXPERT_HEURISTIC')),
 applicable_agents jsonb not null default '[]', required_context jsonb not null default '[]', exceptions jsonb not null default '[]', tags jsonb not null default '[]',
 conflicts_with jsonb not null default '[]', effective_at timestamptz not null, available_at timestamptz not null, deprecated_at timestamptz,
 status text not null check(status in('ACTIVE','DEPRECATED')), system_learned_evidence jsonb, content_hash text not null, created_at timestamptz not null default now(),
 check(effective_at<=available_at), check(deprecated_at is null or deprecated_at>=available_at), unique(rule_key,version), unique(content_hash)
);
create table public.knowledge_rule_sources(rule_id uuid not null references public.knowledge_rules(id),source_id uuid not null references public.knowledge_sources(id),primary key(rule_id,source_id));
create table public.knowledge_retrieval_traces(
 id uuid primary key default gen_random_uuid(), request_hash text not null unique, retrieval_version text not null, agent text not null,
 information_cutoff_at timestamptz not null, context jsonb not null default '{}', selected_rule_refs jsonb not null default '[]', excluded_rules jsonb not null default '[]',
 conflicts jsonb not null default '[]', available_at timestamptz not null, created_at timestamptz not null default now()
);
create or replace function public.validate_knowledge_rule() returns trigger language plpgsql as $$begin
 if new.knowledge_type='SYSTEM_LEARNED' and (new.evidence_level<>'EMPIRICAL_SYSTEM' or new.system_learned_evidence is null or coalesce((new.system_learned_evidence->>'sampleSize')::int,0)<100 or coalesce((new.system_learned_evidence->>'dataQuality')::numeric,0)<80 or coalesce((new.system_learned_evidence->>'outOfSampleValidated')::boolean,false)=false or coalesce(new.system_learned_evidence->>'replayRunId','')='') then raise exception 'SYSTEM_LEARNED evidence policy failed'; end if; return new; end$$;
create trigger validate_knowledge_rule before insert on public.knowledge_rules for each row execute function public.validate_knowledge_rule();
create or replace function public.prevent_knowledge_history_mutation() returns trigger language plpgsql as $$begin raise exception 'Knowledge history is immutable';end$$;
create trigger knowledge_sources_immutable before update or delete on public.knowledge_sources for each row execute function public.prevent_knowledge_history_mutation();
create trigger knowledge_rules_immutable before update or delete on public.knowledge_rules for each row execute function public.prevent_knowledge_history_mutation();
create trigger knowledge_rule_sources_immutable before update or delete on public.knowledge_rule_sources for each row execute function public.prevent_knowledge_history_mutation();
create trigger knowledge_retrieval_traces_immutable before update or delete on public.knowledge_retrieval_traces for each row execute function public.prevent_knowledge_history_mutation();
alter table public.knowledge_sources enable row level security; alter table public.knowledge_rules enable row level security; alter table public.knowledge_rule_sources enable row level security; alter table public.knowledge_retrieval_traces enable row level security;
create policy "public read knowledge sources" on public.knowledge_sources for select using(true); create policy "public read knowledge rules" on public.knowledge_rules for select using(true); create policy "public read knowledge rule sources" on public.knowledge_rule_sources for select using(true); create policy "public read knowledge traces" on public.knowledge_retrieval_traces for select using(true);
grant select on public.knowledge_sources,public.knowledge_rules,public.knowledge_rule_sources,public.knowledge_retrieval_traces to anon,authenticated; grant all on public.knowledge_sources,public.knowledge_rules,public.knowledge_rule_sources,public.knowledge_retrieval_traces to service_role;
alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check check(job_kind in('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering','jackpot_collector','jackpot_outcomes','market_events','paper_eligibility','paper_execution','paper_exits','paper_valuation','performance','fx','qualification','data_gap_closure','simulation','historical_replay','forecast_catalyst','expert_knowledge'));
