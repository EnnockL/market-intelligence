-- Fixed-cutoff, leased asset batches; no partial wallet result becomes public.
create index wallet_transactions_rebuild_asset_idx on public.wallet_transactions(wallet_id,asset_id,occurred_at,id);
create table public.wallet_rebuild_jobs(
 id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id),
 provider text not null, engine_version text not null, cutoff_at timestamptz not null default clock_timestamp(),
 status text not null default 'ACTIVE' check(status in('ACTIVE','COMPLETE')),
 expected_assets integer not null default 0, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), completed_at timestamptz
);
create unique index wallet_rebuild_one_active on public.wallet_rebuild_jobs(wallet_id) where status='ACTIVE';
create table public.wallet_rebuild_parts(
 job_id uuid not null references public.wallet_rebuild_jobs(id), asset_id uuid not null references public.assets(id),
 transaction_count integer not null, status text not null default 'PENDING' check(status in('PENDING','PROCESSING','DONE')),
 lease_token uuid, lease_until timestamptz, payload jsonb,
 primary key(job_id,asset_id), check((status='DONE')=(payload is not null))
);
alter table public.wallet_rebuild_jobs enable row level security;
alter table public.wallet_rebuild_parts enable row level security;
revoke all on public.wallet_rebuild_jobs,public.wallet_rebuild_parts from public,anon,authenticated,service_role;
grant select on public.wallet_rebuild_jobs,public.wallet_rebuild_parts to service_role;

create function public.start_wallet_rebuild(p_wallet uuid,p_provider text,p_engine text)
returns public.wallet_rebuild_jobs language plpgsql security definer set search_path=public as $$
declare j public.wallet_rebuild_jobs;
begin
 if p_provider is null or length(p_provider)=0 or p_engine<>'weighted-average-v2' then raise exception 'INVALID_REBUILD_IDENTITY'; end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet-rebuild:'||p_wallet::text,0));
 select * into j from wallet_rebuild_jobs where wallet_id=p_wallet and status='ACTIVE';
 if found then
   if j.provider<>p_provider or j.engine_version<>p_engine then raise exception 'REBUILD_PROVIDER_CONFLICT'; end if;
   return j;
 end if;
 insert into wallet_rebuild_jobs(wallet_id,provider,engine_version) values(p_wallet,p_provider,p_engine) returning * into j;
 insert into wallet_rebuild_parts(job_id,asset_id,transaction_count)
 select j.id,t.asset_id,count(*) from wallet_transactions t where t.wallet_id=p_wallet and t.asset_id is not null
   and t.side in('buy','sell') and t.ingested_at<=j.cutoff_at and t.occurred_at<=j.cutoff_at group by t.asset_id;
 update wallet_rebuild_jobs set expected_assets=(select count(*) from wallet_rebuild_parts where job_id=j.id) where id=j.id returning * into j;
 return j;
end $$;

create function public.claim_wallet_rebuild_parts(p_job uuid,p_limit integer default 100)
returns table(asset_id uuid,lease_token uuid,transactions jsonb)
language plpgsql security definer set search_path=public as $$
declare j public.wallet_rebuild_jobs; part record; body jsonb; used integer:=0;
begin
 select * into j from wallet_rebuild_jobs where id=p_job and status='ACTIVE';
 if not found then return; end if;
 for part in select p.* from wallet_rebuild_parts p where p.job_id=p_job and
   (p.status='PENDING' or (p.status='PROCESSING' and p.lease_until<clock_timestamp()))
   order by p.asset_id limit least(greatest(p_limit,1),100) for update skip locked
 loop
   if part.transaction_count>5000 then raise exception 'ASSET_TRANSACTION_BUDGET_EXCEEDED:%',part.asset_id; end if;
   if used>0 and used+part.transaction_count>5000 then exit; end if;
   select jsonb_agg(jsonb_build_object('id',t.id,'signature',t.transaction_hash,'instructionIndex',t.instruction_index,
     'token',ct.mint_address,'side',t.side,'quantity',t.quantity,'occurredAt',t.occurred_at,
     'tokenPriceUsd',e.token_price_usd,'feeUsd',e.fee_usd,'pricingComplete',coalesce(e.pricing_completeness=100,false),
     'executionComplete',coalesce(e.execution_completeness=100,false),'informationCompleteness',coalesce(e.information_completeness,0))
     order by t.occurred_at,t.transaction_hash,t.instruction_index,t.id) into body
   from wallet_transactions t left join crypto_tokens ct on ct.asset_id=t.asset_id
   left join wallet_transaction_enrichments e on e.wallet_transaction_id=t.id and e.provider=j.provider
     and e.enrichment_version='wallet-enrichment-v2' and e.known_at<=j.cutoff_at
   where t.wallet_id=j.wallet_id and t.asset_id=part.asset_id and t.side in('buy','sell')
     and t.ingested_at<=j.cutoff_at and t.occurred_at<=j.cutoff_at;
   if coalesce(jsonb_array_length(body),0)<>part.transaction_count then raise exception 'REBUILD_INPUT_CHANGED'; end if;
   if exists(select 1 from jsonb_array_elements(body) b where b->>'token' is null) then raise exception 'WALLET_TOKEN_METADATA_MISSING'; end if;
   asset_id:=part.asset_id; lease_token:=gen_random_uuid(); transactions:=body;
   update wallet_rebuild_parts p set status='PROCESSING',lease_token=claim_wallet_rebuild_parts.lease_token,
     lease_until=clock_timestamp()+interval '240 seconds' where p.job_id=p_job and p.asset_id=part.asset_id;
   used:=used+part.transaction_count;
   return next;
 end loop;
end $$;

-- Read only the actual entry/exit context, plus exact extrema inside the trade.
create function public.wallet_rebuild_context(p_job uuid,p_cycles jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.wallet_rebuild_jobs; item jsonb; a uuid; entry_at timestamptz; exit_at timestamptz;
 result jsonb:='[]'; entry_row jsonb; exit_row jsonb; risk_row jsonb; extrema jsonb; latest text;
begin
 select * into j from wallet_rebuild_jobs where id=p_job;
 if not found or jsonb_typeof(p_cycles)<>'array' or jsonb_array_length(p_cycles)>250 then raise exception 'INVALID_CONTEXT_BATCH'; end if;
 for item in select value from jsonb_array_elements(p_cycles) loop
   a:=(item->>'assetId')::uuid; entry_at:=(item->>'firstEntryAt')::timestamptz; exit_at:=(item->>'finalExitAt')::timestamptz;
   if entry_at is null or entry_at>j.cutoff_at or exit_at>j.cutoff_at or exit_at<entry_at
     or not exists(select 1 from wallet_rebuild_parts where job_id=j.id and asset_id=a)
     then raise exception 'INVALID_CONTEXT_WINDOW'; end if;
   select to_jsonb(l) into entry_row from crypto_liquidity_snapshots l where l.asset_id=a
     and l.effective_at<=entry_at and l.information_available_at<=entry_at and l.observed_at<=j.cutoff_at
     order by l.effective_at desc,l.liquidity_usd desc,coalesce(l.pool_address,''),l.id limit 1;
   exit_row:=null;
   if exit_at is not null then
     select to_jsonb(l) into exit_row from crypto_liquidity_snapshots l where l.asset_id=a
       and l.effective_at<=exit_at and l.information_available_at<=exit_at and l.observed_at<=j.cutoff_at
       order by l.effective_at desc,l.liquidity_usd desc,coalesce(l.pool_address,''),l.id limit 1;
   end if;
   select jsonb_build_object('min',min(l.liquidity_usd),'max',max(l.liquidity_usd)) into extrema
     from crypto_liquidity_snapshots l where l.asset_id=a and l.effective_at>=entry_at
       and l.effective_at<=coalesce(exit_at,j.cutoff_at) and l.information_available_at<=l.effective_at and l.observed_at<=j.cutoff_at;
   select to_jsonb(r) into risk_row from token_risk_assessments r where r.asset_id=a
     and r.information_cutoff_at<=entry_at and r.information_available_at<=entry_at and r.assessed_at<=j.cutoff_at
     order by r.information_cutoff_at desc,r.information_available_at desc,r.id limit 1;
   select r.classification into latest from token_risk_observations r where r.asset_id=a and r.known_at<=j.cutoff_at
     order by r.known_at desc,r.id limit 1;
   result:=result||jsonb_build_array(jsonb_build_object('id',item->>'id','entry',entry_row,'exit',exit_row,
     'minimumLiquidity',extrema->'min','maximumLiquidity',extrema->'max','risk',risk_row,'latestRisk',latest));
 end loop;
 return result;
end $$;

create function public.save_wallet_rebuild_parts(p_job uuid,p_parts jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare j public.wallet_rebuild_jobs; item jsonb; part public.wallet_rebuild_parts; n integer:=0;
begin
 select * into j from wallet_rebuild_jobs where id=p_job and status='ACTIVE' for update;
 if not found or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>100 then raise exception 'INVALID_PART_BATCH'; end if;
 for item in select value from jsonb_array_elements(p_parts) loop
   select * into part from wallet_rebuild_parts where job_id=p_job and asset_id=(item->>'assetId')::uuid for update;
   if part.status is distinct from 'PROCESSING' or part.lease_token is distinct from (item->>'leaseToken')::uuid
     or part.lease_until<clock_timestamp() then raise exception 'REBUILD_LEASE_LOST'; end if;
   if jsonb_typeof(item->'payload'->'rows') is distinct from 'array' or jsonb_typeof(item->'payload'->'cycles') is distinct from 'array'
     or jsonb_array_length(item->'payload'->'rows')<>jsonb_array_length(item->'payload'->'cycles')
     or jsonb_array_length(item->'payload'->'rows')>part.transaction_count then raise exception 'INVALID_PART_PAYLOAD'; end if;
   if exists(select 1 from jsonb_array_elements(item->'payload'->'rows') r where
     r->>'wallet_id' is distinct from j.wallet_id::text or r->>'asset_id' is distinct from part.asset_id::text
     or r->>'engine_version' is distinct from j.engine_version) then raise exception 'PART_IDENTITY_MISMATCH'; end if;
   update wallet_rebuild_parts set status='DONE',payload=item->'payload',lease_token=null,lease_until=null
     where job_id=p_job and asset_id=part.asset_id;
   n:=n+1;
 end loop;
 update wallet_rebuild_jobs set updated_at=clock_timestamp() where id=p_job;
 return n;
end $$;

-- Private helper preserves defaults on columns absent from the payload.
create function public.insert_wallet_rebuild_rows(p_table regclass,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare columns_sql text;
begin
 if p_table not in('wallet_trade_cycles'::regclass,'wallet_performance_points'::regclass,'wallet_metric_snapshots'::regclass,
   'wallet_scores'::regclass,'wallet_verification_evaluations'::regclass,'wallet_verification_progress'::regclass)
   or jsonb_typeof(p_rows)<>'array' then raise exception 'INVALID_REBUILD_TABLE'; end if;
 if jsonb_array_length(p_rows)=0 then return; end if;
 select string_agg(quote_ident(key),',' order by key) into columns_sql from jsonb_object_keys(p_rows->0) key;
 execute format('insert into %s(%s) select %s from jsonb_populate_recordset(null::%s,$1)',p_table,columns_sql,columns_sql,p_table) using p_rows;
end $$;

create function public.publish_wallet_rebuild(p_job uuid,p_summary jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare j public.wallet_rebuild_jobs; rows_json jsonb; item record; n integer;
begin
 select * into j from wallet_rebuild_jobs where id=p_job for update;
 if j.id is null then raise exception 'REBUILD_NOT_FOUND'; end if;
 if j.status='COMPLETE' then return 0; end if;
 if exists(select 1 from wallet_rebuild_parts where job_id=p_job and status<>'DONE')
   or (select count(*) from wallet_rebuild_parts where job_id=p_job)<>j.expected_assets then raise exception 'REBUILD_INCOMPLETE'; end if;
 for item in select key,value from jsonb_each(p_summary) loop
   if item.key not in('wallet_performance_points','wallet_metric_snapshots','wallet_scores','wallet_verification_evaluations','wallet_verification_progress')
     or jsonb_typeof(item.value)<>'array' then raise exception 'INVALID_SUMMARY_TABLE'; end if;
   if exists(select 1 from jsonb_array_elements(item.value) r where r->>'wallet_id' is distinct from j.wallet_id::text)
     then raise exception 'SUMMARY_IDENTITY_MISMATCH'; end if;
 end loop;
 if coalesce(jsonb_array_length(p_summary->'wallet_metric_snapshots'),0)<>1
   or coalesce(jsonb_array_length(p_summary->'wallet_scores'),0)<>2
   or coalesce(jsonb_array_length(p_summary->'wallet_verification_evaluations'),0)<>1
   or coalesce(jsonb_array_length(p_summary->'wallet_verification_progress'),0)<>1
   or jsonb_typeof(p_summary->'wallet_performance_points') is distinct from 'array' then raise exception 'SUMMARY_INCOMPLETE'; end if;
 select coalesce(jsonb_agg(r.value),'[]') into rows_json from wallet_rebuild_parts p cross join lateral jsonb_array_elements(p.payload->'rows') r where p.job_id=p_job;
 n:=jsonb_array_length(rows_json);
 delete from wallet_performance_points where wallet_id=j.wallet_id and curve_version='realized-pnl-curve-v1';
 delete from wallet_trade_cycles where wallet_id=j.wallet_id and engine_version=j.engine_version;
 perform insert_wallet_rebuild_rows('wallet_trade_cycles',rows_json);
 for item in select key,value from jsonb_each(p_summary) loop
   perform insert_wallet_rebuild_rows(('public.'||quote_ident(item.key))::regclass,item.value);
 end loop;
 update wallet_rebuild_jobs set status='COMPLETE',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_job;
 return n;
end $$;

revoke all on function public.start_wallet_rebuild(uuid,text,text),public.claim_wallet_rebuild_parts(uuid,integer),
 public.wallet_rebuild_context(uuid,jsonb),public.save_wallet_rebuild_parts(uuid,jsonb),public.insert_wallet_rebuild_rows(regclass,jsonb),
 public.publish_wallet_rebuild(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.start_wallet_rebuild(uuid,text,text),public.claim_wallet_rebuild_parts(uuid,integer),
 public.wallet_rebuild_context(uuid,jsonb),public.save_wallet_rebuild_parts(uuid,jsonb),public.publish_wallet_rebuild(uuid,jsonb) to service_role;
