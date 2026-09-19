-- Pre-register future OOS windows. Historical exploratory runs remain unchanged.
create table public.strategy_dataset_plans (
  id uuid primary key default gen_random_uuid(), strategy_definition_id uuid not null references public.strategy_definitions(id),
  asset_id uuid not null references public.assets(id), provider text not null, starts_at timestamptz not null,
  ends_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
  check(created_at<=starts_at and starts_at<ends_at), check(length(provider)>0)
);
create table public.strategy_frozen_datasets (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null unique references public.strategy_dataset_plans(id),
  dataset_hash text not null, payload jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.strategy_dataset_plans enable row level security;
alter table public.strategy_frozen_datasets enable row level security;
revoke all on public.strategy_dataset_plans,public.strategy_frozen_datasets from public,anon,authenticated,service_role;
grant select on public.strategy_dataset_plans,public.strategy_frozen_datasets to service_role;
create trigger strategy_dataset_plans_immutable before update or delete on public.strategy_dataset_plans for each row execute function public.prevent_strategy_lab_mutation();
create trigger strategy_frozen_datasets_immutable before update or delete on public.strategy_frozen_datasets for each row execute function public.prevent_strategy_lab_mutation();

create function public.register_strategy_dataset(p_definition_id uuid,p_asset_id uuid,p_provider text,p_starts_at timestamptz,p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
  if p_starts_at is null or p_ends_at is null or p_starts_at<clock_timestamp() or p_ends_at<=p_starts_at
    or p_provider is null or length(trim(p_provider))=0 then raise exception 'PROSPECTIVE_WINDOW_REQUIRED'; end if;
  -- One prospective test per immutable strategy version and asset; failed tests
  -- cannot be replaced by another cherry-picked window under the same version.
  perform 1 from public.strategy_definitions where id=p_definition_id and status='ACTIVE' for update;
  if not found then raise exception 'ACTIVE_STRATEGY_REQUIRED'; end if;
  if exists(select 1 from public.strategy_dataset_plans where strategy_definition_id=p_definition_id and asset_id=p_asset_id)
    then raise exception 'STRATEGY_WINDOW_ALREADY_REGISTERED'; end if;
  insert into public.strategy_dataset_plans(strategy_definition_id,asset_id,provider,starts_at,ends_at)
    values(p_definition_id,p_asset_id,p_provider,p_starts_at,p_ends_at) returning id into result;
  return result;
end; $$;

create function public.seal_strategy_dataset(p_plan_id uuid)
returns public.strategy_frozen_datasets language plpgsql security definer set search_path=public,extensions as $$
declare p public.strategy_dataset_plans; d public.strategy_definitions; result public.strategy_frozen_datasets;
  candles jsonb; regimes jsonb; body jsonb;
begin
  select * into p from public.strategy_dataset_plans where id=p_plan_id for update;
  if p.id is null or p.ends_at>clock_timestamp() then raise exception 'PROSPECTIVE_WINDOW_NOT_COMPLETE'; end if;
  select * into result from public.strategy_frozen_datasets where plan_id=p.id;
  if found then return result; end if;
  select * into d from public.strategy_definitions where id=p.strategy_definition_id;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.opened_at,c.id),'[]') into candles from public.market_candles c
    where c.asset_id=p.asset_id and c.provider=p.provider and c.timeframe=d.timeframe and c.opened_at>=p.starts_at
      and c.closed_at<=p.ends_at and c.available_at<=p.ends_at and c.created_at<=p.ends_at;
  if jsonb_array_length(candles)<20 or jsonb_array_length(candles)>100000
    or exists(select 1 from jsonb_array_elements(candles) c where (c->>'data_quality')::int<80)
    then raise exception 'FROZEN_DATASET_COVERAGE_INSUFFICIENT'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.information_cutoff_at,r.id),'[]') into regimes from public.market_regime_snapshots r
    where r.available_at<=p.ends_at and r.information_cutoff_at<=p.ends_at and r.created_at<=p.ends_at;
  body:=jsonb_build_object('version','prospective-dataset-v1','engineVersion','strategy-pattern-lab-v2','plan',to_jsonb(p),'definition',d.definition,
    'definitionHash',d.definition_hash,'candles',candles,'regimes',regimes);
  insert into public.strategy_frozen_datasets(plan_id,dataset_hash,payload)
    values(p.id,encode(digest(body::text,'sha256'),'hex'),body) returning * into result;
  return result;
end; $$;
revoke all on function public.register_strategy_dataset(uuid,uuid,text,timestamptz,timestamptz),public.seal_strategy_dataset(uuid) from public,anon,authenticated;
grant execute on function public.register_strategy_dataset(uuid,uuid,text,timestamptz,timestamptz),public.seal_strategy_dataset(uuid) to service_role;

alter table public.strategy_evaluation_runs add column frozen_dataset_id uuid references public.strategy_frozen_datasets(id);
create unique index strategy_one_frozen_evaluation on public.strategy_evaluation_runs(frozen_dataset_id) where frozen_dataset_id is not null;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.strategy_evaluation_runs'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%available_at%' loop
    execute format('alter table public.strategy_evaluation_runs drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.strategy_evaluation_runs add constraint strategy_evaluation_publication_check check(
  (frozen_dataset_id is null and available_at<=information_cutoff_at) or (frozen_dataset_id is not null and available_at>=information_cutoff_at));

create function public.verify_frozen_strategy_evaluation() returns trigger language plpgsql set search_path=public as $$
declare f public.strategy_frozen_datasets; p public.strategy_dataset_plans;
begin
  if new.frozen_dataset_id is null then return new; end if;
  select * into f from public.strategy_frozen_datasets where id=new.frozen_dataset_id;
  select * into p from public.strategy_dataset_plans where id=f.plan_id;
  if new.strategy_definition_id is distinct from p.strategy_definition_id or new.asset_id is distinct from p.asset_id
    or new.lab_version is distinct from f.payload->>'engineVersion'
    or new.input_hash is distinct from f.dataset_hash or new.information_cutoff_at is distinct from p.ends_at
    or new.candle_count is distinct from jsonb_array_length(f.payload->'candles') or new.available_at<f.created_at
    then raise exception 'FROZEN_EVALUATION_MISMATCH'; end if;
  return new;
end; $$;
create trigger strategy_frozen_evaluation_guard before insert on public.strategy_evaluation_runs for each row execute function public.verify_frozen_strategy_evaluation();

alter table public.strategy_performance_snapshots drop constraint strategy_performance_provenance_v2_check;
alter table public.strategy_performance_snapshots add constraint strategy_performance_provenance_v2_check check (
  performance_version<>'strategy-research-v2' or coalesce((provenance is not null and provenance->>'version'='intelligence-provenance-v1' and (
    (provenance->>'status'='UNVERIFIED' and dataset_split in ('TRAIN','EXPLORATION')) or
    (provenance->>'status'='VERIFIED' and dataset_split='OUT_OF_SAMPLE' and provenance->>'windowSource'='FROZEN_DATASET_MANIFEST'
      and provenance->>'frozenDatasetId' is not null))),false));
create function public.verify_frozen_strategy_performance() returns trigger language plpgsql set search_path=public as $$
declare r public.strategy_evaluation_runs; f public.strategy_frozen_datasets; p public.strategy_dataset_plans;
begin
  if new.provenance->>'status' is distinct from 'VERIFIED' then return new; end if;
  select * into r from public.strategy_evaluation_runs where id=new.evaluation_run_id;
  select * into f from public.strategy_frozen_datasets where id=r.frozen_dataset_id;
  select * into p from public.strategy_dataset_plans where id=f.plan_id;
  if f.id is null or new.provenance->>'frozenDatasetId' is distinct from f.id::text
    or new.provenance->>'prospectivePlanId' is distinct from p.id::text
    or new.provenance->>'evaluationInputHash' is distinct from r.input_hash or r.input_hash is distinct from f.dataset_hash
    or new.strategy_definition_id is distinct from p.strategy_definition_id or new.asset_id is distinct from p.asset_id
    or new.evaluation_window_start is distinct from p.starts_at or new.evaluation_window_end is distinct from p.ends_at
    or new.information_cutoff_at is distinct from p.ends_at or new.available_at<greatest(f.created_at,r.available_at,r.created_at)
    or new.trade_count is distinct from r.trade_count or new.sample_size is distinct from r.sample_size
    or r.trade_count<>(select count(*) from public.strategy_evaluation_trades where evaluation_run_id=r.id)
    then raise exception 'FROZEN_PERFORMANCE_MISMATCH'; end if;
  return new;
end; $$;
create trigger strategy_frozen_performance_guard before insert on public.strategy_performance_snapshots for each row execute function public.verify_frozen_strategy_performance();

-- Publish a frozen evaluation and its complete ledger atomically. No partial
-- result can win idempotency and permanently prevent a retry from completing.
create function public.publish_frozen_strategy_evaluation(p_run jsonb,p_trades jsonb,p_segments jsonb)
returns uuid language plpgsql set search_path=public as $$
declare run_id uuid; existing public.strategy_evaluation_runs; item jsonb;
begin
  if p_run->>'frozen_dataset_id' is null or jsonb_typeof(p_trades) is distinct from 'array'
    or jsonb_typeof(p_segments) is distinct from 'array'
    or (p_run->>'trade_count')::int is distinct from jsonb_array_length(p_trades)
    then raise exception 'FROZEN_PUBLICATION_INCOMPLETE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_run->>'frozen_dataset_id',0));
  select * into existing from public.strategy_evaluation_runs where frozen_dataset_id=(p_run->>'frozen_dataset_id')::uuid;
  if found then
    if existing.input_hash is distinct from p_run->>'input_hash' or existing.result_hash is distinct from p_run->>'result_hash'
      or existing.trade_count<>(select count(*) from public.strategy_evaluation_trades where evaluation_run_id=existing.id)
      then raise exception 'FROZEN_PUBLICATION_CONFLICT'; end if;
    return existing.id;
  end if;
  run_id:=gen_random_uuid();
  insert into public.strategy_evaluation_runs select * from jsonb_populate_record(null::public.strategy_evaluation_runs,
    p_run||jsonb_build_object('id',run_id,'created_at',clock_timestamp(),'available_at',clock_timestamp()));
  for item in select value from jsonb_array_elements(p_trades) loop
    insert into public.strategy_evaluation_trades select * from jsonb_populate_record(null::public.strategy_evaluation_trades,
      item||jsonb_build_object('id',gen_random_uuid(),'evaluation_run_id',run_id,'created_at',clock_timestamp()));
  end loop;
  for item in select value from jsonb_array_elements(p_segments) loop
    insert into public.strategy_segment_metrics select * from jsonb_populate_record(null::public.strategy_segment_metrics,
      item||jsonb_build_object('id',gen_random_uuid(),'evaluation_run_id',run_id,'created_at',clock_timestamp()));
  end loop;
  return run_id;
end; $$;
revoke all on function public.publish_frozen_strategy_evaluation(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_frozen_strategy_evaluation(jsonb,jsonb,jsonb) to service_role;
