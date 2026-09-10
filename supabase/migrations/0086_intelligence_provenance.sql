-- Preserve all v1 results as historical records. No existing result is reclassified.
alter table public.strategy_performance_snapshots
  add column provenance jsonb;

alter table public.strategy_performance_snapshots
  drop constraint strategy_performance_snapshots_dataset_split_check;
alter table public.strategy_performance_snapshots
  add constraint strategy_performance_snapshots_dataset_split_check
  check (dataset_split in ('TRAIN','VALIDATION','OUT_OF_SAMPLE','EXPLORATION'));

-- The old compound uniqueness omitted the model/provenance version. snapshot_key
-- already supplies full immutable identity; allow new evidence alongside v1.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.strategy_performance_snapshots'::regclass
      and contype = 'u' and array_length(conkey, 1) = 5
      and pg_get_constraintdef(oid) = 'UNIQUE (strategy_definition_id, evaluation_run_id, evaluation_window_start, evaluation_window_end, dataset_split)'
  loop
    execute format('alter table public.strategy_performance_snapshots drop constraint %I', constraint_row.conname);
  end loop;
end $$;

-- Historical information cutoff and the actual publication time are different.
-- Keep legacy semantics untouched; newly published v2 artifacts cannot be backdated.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conrelid::regclass as target, conname from pg_constraint
    where conrelid in ('public.strategy_performance_snapshots'::regclass, 'public.strategy_selector_runs'::regclass)
      and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK ((available_at <= information_cutoff_at))'
  loop
    execute format('alter table %s drop constraint %I', constraint_row.target, constraint_row.conname);
  end loop;
end $$;

alter table public.strategy_performance_snapshots
  add constraint strategy_performance_publication_v2_check check (
    (performance_version = 'strategy-research-v2' and available_at >= information_cutoff_at)
    or (performance_version <> 'strategy-research-v2' and available_at <= information_cutoff_at)
  ),
  add constraint strategy_performance_provenance_v2_check check (
    performance_version <> 'strategy-research-v2' or (
      provenance is not null and jsonb_typeof(provenance) = 'object'
      and coalesce(provenance->>'version', '') = 'intelligence-provenance-v1'
      -- No current producer has a prospectively frozen source manifest.
      -- Enabling verified OOS requires a new manifest-verifying contract.
      and coalesce(provenance->>'status', '') = 'UNVERIFIED'
      and dataset_split in ('TRAIN', 'EXPLORATION')
    )
  );
alter table public.strategy_selector_runs
  add constraint strategy_selector_publication_v2_check check (
    (selector_version = 'strategy-selector-v2' and available_at >= information_cutoff_at)
    or (selector_version <> 'strategy-selector-v2' and available_at <= information_cutoff_at)
  );

comment on column public.strategy_performance_snapshots.provenance is
  'V2 records source run hash and observed validation links. Post-hoc phase labels are not OOS proof. V1 rows stay null and are excluded by selector v2.';
