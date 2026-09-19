import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkProspectiveStrategyDatasets(db) {
  await db.exec('reset role; begin');
  try {
    const asset=randomUUID(), definition=randomUUID(), plan=randomUUID(); let run=randomUUID();
    const start='2026-08-01T00:00:00.000Z', end='2026-08-02T00:00:00.000Z';
    const reject=async(fn,pattern)=>{await db.exec('savepoint rejected');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}};
    await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'OOS fixture')",[asset,`OOS_${asset}`]);
    await db.query(`insert into public.strategy_definitions(id,strategy_key,version,name,market,timeframe,setup_type,definition,definition_hash,effective_at,available_at)
      values($1,$2,1,'OOS fixture','GENERIC','5m','EMA_VWAP_MOMENTUM','{}',$2,$3,$3)`,[definition,`oos-${definition}`,start]);
    // Superuser fixture only: production registration cannot create past plans.
    await db.query(`insert into public.strategy_dataset_plans(id,strategy_definition_id,asset_id,provider,starts_at,ends_at,created_at)
      values($1,$2,$3,'oos-fixture',$4,$5,'2026-07-31T00:00:00Z')`,[plan,definition,asset,start,end]);
    await db.query(`insert into public.market_candles(candle_key,asset_id,provider,timeframe,opened_at,closed_at,observed_at,available_at,open,high,low,close,volume,data_quality,created_at)
      select $1||n,$2,'oos-fixture','5m',$3::timestamptz+n*interval '5 minutes',$3::timestamptz+(n+1)*interval '5 minutes',
      $3::timestamptz+(n+1)*interval '5 minutes',$3::timestamptz+(n+1)*interval '5 minutes',100,102,99,101,10,100,
      case when n=20 then $4::timestamptz+interval '1 day' else $3::timestamptz+(n+1)*interval '5 minutes' end from generate_series(0,20) n`,[plan,asset,start,end]);
    await db.exec('set local role service_role');
    await reject(()=>db.query("select public.register_strategy_dataset($1,$2,'oos-fixture',$3,$4)",[definition,asset,start,end]),/PROSPECTIVE_WINDOW_REQUIRED/);
    await reject(()=>db.query('insert into public.strategy_dataset_plans(strategy_definition_id,asset_id,provider,starts_at,ends_at) values($1,$2,\'x\',now()+interval \'1 day\',now()+interval \'2 days\')',[definition,asset]),/permission denied/);
    const sealed=(await db.query('select to_jsonb(public.seal_strategy_dataset($1)) result',[plan])).rows[0].result;
    assert.equal(sealed.payload.candles.length,20,'late/backdated source is excluded');
    assert.equal((await db.query('select to_jsonb(public.seal_strategy_dataset($1)) result',[plan])).rows[0].result.id,sealed.id,'same immutable dataset on retry');
    const insertRun=hash=>db.query(`insert into public.strategy_evaluation_runs(id,run_key,lab_version,strategy_definition_id,asset_id,information_cutoff_at,available_at,status,input_hash,candle_count,setup_count,trade_count,sample_size,minimum_sample_size,metrics,result_hash,frozen_dataset_id)
      values($1::uuid,$1::text,'strategy-pattern-lab-v2',$2,$3,$4,clock_timestamp(),'INSUFFICIENT_DATA',$5,20,0,0,0,30,'{}',$5,$6)`,[run,definition,asset,end,hash,sealed.id]);
    await reject(()=>insertRun('bad-hash'),/FROZEN_EVALUATION_MISMATCH/);
    const runRecord={run_key:run,lab_version:'strategy-pattern-lab-v2',strategy_definition_id:definition,asset_id:asset,information_cutoff_at:end,status:'INSUFFICIENT_DATA',input_hash:sealed.dataset_hash,candle_count:20,setup_count:1,trade_count:1,sample_size:1,minimum_sample_size:30,metrics:{},result_hash:sealed.dataset_hash,frozen_dataset_id:sealed.id};
    const trade={trade_key:randomUUID(),side:'LONG',setup_at:start,entered_at:'2026-08-01T00:05:00Z',exited_at:'2026-08-01T00:10:00Z',entry:100,stop:99,target:102,exit:102,outcome:'WIN',r_multiple:2,mfe_r:2,mae_r:0,hold_minutes:5,evidence_refs:[],session:'UNKNOWN',weekday:'Saturday',regime:'UNKNOWN',entry_hour:'00',volatility_bucket:'UNKNOWN'};
    const publish=segments=>db.query("select public.publish_frozen_strategy_evaluation($1,$2,$3) id",[JSON.stringify(runRecord),JSON.stringify([trade]),JSON.stringify(segments)]);
    await reject(()=>publish([{dimension:'invalid'}]),/constraint|null value/);
    assert.equal((await db.query('select count(*)::int n from public.strategy_evaluation_runs where frozen_dataset_id=$1',[sealed.id])).rows[0].n,0,'failed segment insert rolls back the run');
    run=(await publish([])).rows[0].id;
    assert.equal((await publish([])).rows[0].id,run,'atomic publication retry is idempotent');
    const provenance={version:'intelligence-provenance-v1',status:'VERIFIED',windowSource:'FROZEN_DATASET_MANIFEST',frozenDatasetId:sealed.id,prospectivePlanId:plan,evaluationInputHash:sealed.dataset_hash,validationRunIds:[],observedPhases:['OUT_OF_SAMPLE']};
    await db.query(`insert into public.strategy_performance_snapshots(snapshot_key,performance_version,strategy_definition_id,evaluation_run_id,asset_id,evaluation_window_start,evaluation_window_end,information_cutoff_at,available_at,dataset_hash,market,asset_class,timeframe,session,regime,dataset_split,status,sample_size,setup_count,trade_count,metrics,segments,result_hash,provenance)
      values($1,'strategy-research-v2',$2,$3,$4,$5,$6,$6,clock_timestamp(),$1,'GENERIC','CRYPTO','5m','UNKNOWN','UNKNOWN','OUT_OF_SAMPLE','INSUFFICIENT_DATA',1,1,1,'{}','[]',$1,$7)`,[randomUUID(),definition,run,asset,start,end,JSON.stringify(provenance)]);
    await db.exec('reset role');
    await reject(()=>db.query("update public.strategy_frozen_datasets set dataset_hash='changed' where id=$1",[sealed.id]),/immutable/i);
    const futureDef=randomUUID();
    await db.query(`insert into public.strategy_definitions(id,strategy_key,version,name,market,timeframe,setup_type,definition,definition_hash,effective_at,available_at)
      values($1,$2,1,'future fixture','GENERIC','5m','EMA_VWAP_MOMENTUM','{}',$2,$3,$3)`,[futureDef,`future-${futureDef}`,start]);
    await db.exec('set local role service_role');
    const future=(await db.query("select public.register_strategy_dataset($1,$2,'oos-fixture',now()+interval '1 day',now()+interval '2 days') id",[futureDef,asset])).rows[0].id;
    await reject(()=>db.query('select public.seal_strategy_dataset($1)',[future]),/PROSPECTIVE_WINDOW_NOT_COMPLETE/);
    await reject(()=>db.query("select public.register_strategy_dataset($1,$2,'oos-fixture',now()+interval '3 days',now()+interval '4 days')",[futureDef,asset]),/ALREADY_REGISTERED/);
    console.log('Prospective OOS: roles, future-only registration, no window replacement, immutable sealing, late-data exclusion, exact evaluation binding and verified publication passed.');
  } finally { await db.exec('reset role; rollback'); }
}
