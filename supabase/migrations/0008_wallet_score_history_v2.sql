alter table public.wallet_scores
  add column if not exists data_cutoff_at timestamptz,
  add column if not exists lifecycle text not null default 'candidate';
update public.wallet_scores set data_cutoff_at = calculated_at where data_cutoff_at is null;
alter table public.wallet_scores alter column data_cutoff_at set not null;
alter table public.wallet_scores add constraint wallet_scores_cutoff_check check(data_cutoff_at <= calculated_at);
alter table public.wallet_scores add constraint wallet_scores_lifecycle_check
  check(lifecycle in ('candidate','reviewing','verified','elite','rejected','bot','mev','exchange','program','low_quality'));
create index wallet_scores_point_in_time_idx on public.wallet_scores(wallet_id, data_cutoff_at desc, calculated_at desc);

alter table public.wallet_transaction_enrichments
  add column information_completeness smallint not null default 0 check(information_completeness between 0 and 100),
  add column priority_fee_status text not null default 'not_evaluated';

alter table public.wallet_discovery_candidates drop constraint if exists wallet_discovery_candidates_status_check;
alter table public.wallet_discovery_candidates add constraint wallet_discovery_candidates_status_check
  check(status in ('candidate','reviewing','verified','elite','rejected','bot','mev','exchange','program','low_quality'));

comment on column public.wallet_scores.data_cutoff_at is 'Latest information timestamp used by this score; required for replay without look-ahead bias.';
comment on column public.wallet_transaction_enrichments.priority_fee_status is 'Explicit reason when priority fee cannot be derived; null never means silently zero.';
