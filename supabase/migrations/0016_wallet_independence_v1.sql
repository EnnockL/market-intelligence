create table public.wallet_relationship_evidence (
  id uuid primary key default gen_random_uuid(), wallet_a_id uuid not null references public.wallets(id), wallet_b_id uuid not null references public.wallets(id),
  evidence_type text not null check(evidence_type in ('common_funder','funding_window','shared_counterparty','synchronized_behavior','common_creation_window')),
  classification text not null check(classification in ('same_owner_support','coordination_support','shared_service','independence_support','unknown')),
  source_classification text not null check(source_classification in ('wallet','exchange','bridge','program','unknown')),
  confidence smallint not null check(confidence between 0 and 100), supports_cluster boolean not null,
  observed_at timestamptz not null, available_at timestamptz not null, provider text not null, source_reference text not null,
  evidence jsonb not null default '{}', evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  wallet_pair_key text generated always as (least(wallet_a_id::text,wallet_b_id::text)||':'||greatest(wallet_a_id::text,wallet_b_id::text)) stored,
  check(wallet_a_id<>wallet_b_id),check(observed_at<=available_at),unique(wallet_pair_key,evidence_type,provider,source_reference,evidence_hash)
);
create index wallet_relationship_evidence_cutoff_idx on public.wallet_relationship_evidence(wallet_pair_key,available_at desc);

create table public.solana_address_classification_observations (
  id uuid primary key default gen_random_uuid(), address text not null, classification text not null check(classification in ('wallet','exchange','bridge','program','unknown')),
  label text, confidence smallint not null check(confidence between 0 and 100), provider text not null, observed_at timestamptz not null,
  available_at timestamptz not null, evidence jsonb not null default '{}', check(observed_at<=available_at),unique(address,classification,provider,observed_at)
);
create index solana_address_classification_cutoff_idx on public.solana_address_classification_observations(address,available_at desc);

create table public.wallet_cluster_snapshots (
  id uuid primary key default gen_random_uuid(), scope_hash text not null, model_version text not null, information_cutoff_at timestamptz not null,
  raw_wallet_count integer not null check(raw_wallet_count>=0), relationship_pair_count integer not null check(relationship_pair_count>=0),
  covered_pair_count integer not null check(covered_pair_count>=0), relationship_coverage numeric(6,3) not null check(relationship_coverage between 0 and 100),
  confirmed_independent_count integer not null check(confirmed_independent_count>=0), cluster_adjusted_count numeric(10,4),
  status text not null check(status in ('available','unknown')), data_quality smallint not null check(data_quality between 0 and 100),
  observed_at timestamptz not null, available_at timestamptz not null, evidence jsonb not null default '{}', created_at timestamptz not null default now(),
  check(observed_at<=available_at),check((status='unknown' and cluster_adjusted_count is null) or status='available'),
  unique(scope_hash,model_version,information_cutoff_at)
);
create index wallet_cluster_snapshots_cutoff_idx on public.wallet_cluster_snapshots(scope_hash,information_cutoff_at desc,available_at desc);

create table public.wallet_cluster_memberships (
  snapshot_id uuid not null references public.wallet_cluster_snapshots(id), wallet_id uuid not null references public.wallets(id),
  cluster_id text, relationship_status text not null check(relationship_status in ('independent','clustered','unknown')),
  independence_score smallint, cluster_confidence smallint, funding_source_classification text not null check(funding_source_classification in ('wallet','exchange','bridge','program','unknown')),
  bot_risk smallint, mev_risk smallint, exchange_risk smallint, evidence_refs jsonb not null default '[]',
  check(independence_score is null or independence_score between 0 and 100),check(cluster_confidence is null or cluster_confidence between 0 and 100),
  check(bot_risk is null or bot_risk between 0 and 100),check(mev_risk is null or mev_risk between 0 and 100),check(exchange_risk is null or exchange_risk between 0 and 100),
  primary key(snapshot_id,wallet_id)
);
create index wallet_cluster_membership_wallet_idx on public.wallet_cluster_memberships(wallet_id,snapshot_id);

create or replace function public.prevent_wallet_intelligence_mutation() returns trigger language plpgsql as $$
begin raise exception 'Wallet relationship evidence and cluster history are immutable'; end $$;
create trigger wallet_relationship_evidence_immutable before update or delete on public.wallet_relationship_evidence for each row execute function public.prevent_wallet_intelligence_mutation();
create trigger solana_address_classification_immutable before update or delete on public.solana_address_classification_observations for each row execute function public.prevent_wallet_intelligence_mutation();
create trigger wallet_cluster_snapshots_immutable before update or delete on public.wallet_cluster_snapshots for each row execute function public.prevent_wallet_intelligence_mutation();
create trigger wallet_cluster_memberships_immutable before update or delete on public.wallet_cluster_memberships for each row execute function public.prevent_wallet_intelligence_mutation();

alter table public.wallet_relationship_evidence enable row level security;
alter table public.solana_address_classification_observations enable row level security;
alter table public.wallet_cluster_snapshots enable row level security;
alter table public.wallet_cluster_memberships enable row level security;
create policy "public read wallet cluster snapshots" on public.wallet_cluster_snapshots for select using(true);
create policy "public read wallet cluster memberships" on public.wallet_cluster_memberships for select using(true);
grant select on public.wallet_cluster_snapshots,public.wallet_cluster_memberships to anon,authenticated;
grant all privileges on public.wallet_relationship_evidence,public.solana_address_classification_observations,public.wallet_cluster_snapshots,public.wallet_cluster_memberships to service_role;

alter table public.ingestion_runs drop constraint if exists ingestion_runs_job_kind_check;
alter table public.ingestion_runs add constraint ingestion_runs_job_kind_check
  check(job_kind in ('stock_quotes','wallet_transactions','wallet_discovery','crypto_market','wallet_pnl','wallet_evidence','fast_flow','wallet_clustering'));
