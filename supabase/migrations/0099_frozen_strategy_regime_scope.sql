-- Freeze only market regimes belonging to the tested asset class.
create or replace function public.seal_strategy_dataset(p_plan_id uuid)
returns public.strategy_frozen_datasets language plpgsql security definer set search_path=public,extensions as $$
declare p public.strategy_dataset_plans; d public.strategy_definitions; result public.strategy_frozen_datasets;
  candles jsonb; regimes jsonb; body jsonb; asset_scope text;
begin
  select * into p from public.strategy_dataset_plans where id=p_plan_id for update;
  if p.id is null or p.ends_at>clock_timestamp() then raise exception 'PROSPECTIVE_WINDOW_NOT_COMPLETE'; end if;
  select * into result from public.strategy_frozen_datasets where plan_id=p.id;
  if found then return result; end if;
  select * into d from public.strategy_definitions where id=p.strategy_definition_id;
  select upper(kind::text) into asset_scope from public.assets where id=p.asset_id;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.opened_at,c.id),'[]') into candles from public.market_candles c
    where c.asset_id=p.asset_id and c.provider=p.provider and c.timeframe=d.timeframe and c.opened_at>=p.starts_at
      and c.closed_at<=p.ends_at and c.available_at<=p.ends_at and c.created_at<=p.ends_at;
  if jsonb_array_length(candles)<20 or jsonb_array_length(candles)>100000
    or exists(select 1 from jsonb_array_elements(candles) c where (c->>'data_quality')::int<80)
    then raise exception 'FROZEN_DATASET_COVERAGE_INSUFFICIENT'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.information_cutoff_at,r.id),'[]') into regimes from public.market_regime_snapshots r
    where r.scope=asset_scope and r.available_at<=p.ends_at and r.information_cutoff_at<=p.ends_at and r.created_at<=p.ends_at;
  body:=jsonb_build_object('version','prospective-dataset-v1','engineVersion','strategy-pattern-lab-v2','plan',to_jsonb(p),'definition',d.definition,
    'assetClass',asset_scope,'definitionHash',d.definition_hash,'candles',candles,'regimes',regimes);
  insert into public.strategy_frozen_datasets(plan_id,dataset_hash,payload)
    values(p.id,encode(digest(body::text,'sha256'),'hex'),body) returning * into result;
  return result;
end; $$;
