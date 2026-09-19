import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkDemoTrialGuard(db,{fixture,authorize,asset}){
  const old='public.authorize_execution_submission_pre_trial(uuid,text,text,bigint,uuid,bigint,uuid,uuid,uuid,jsonb)';
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') allowed",[old])).rows[0].allowed,false);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'public.demo_trials','select') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege('service_role','public.demo_trials','update') allowed")).rows[0].allowed,false);
  const cases=[['valid',null],['disabled','FINAL_DEMO_TRIAL_SCOPE'],['expired','FINAL_DEMO_TRIAL_SCOPE'],['sell-old','FINAL_DEMO_TRIAL_SELL_INVENTORY'],
    ['oversize','FINAL_DEMO_TRIAL_ORDER_LIMIT'],['cash','FINAL_DEMO_TRIAL_BUDGET'],['exposure','FINAL_DEMO_TRIAL_BUDGET'],['fees','FINAL_DEMO_TRIAL_BUDGET'],
    ['unknown','FINAL_DEMO_TRIAL_EVIDENCE'],['wrong-risk','FINAL_DEMO_TRIAL_EVIDENCE'],['wrong-source','FINAL_DEMO_TRIAL_SCOPE'],['kill','FINAL_KILL_SWITCH_ACTIVE']];
  for(const [kind,reason] of cases){
    await db.exec('reset role; begin');
    try{
      const action=randomUUID(),trial=randomUUID(),snapshot=randomUUID(),started=new Date(Date.now()-86400000).toISOString();
      await db.exec('set local role service_role');
      const f=await fixture('DEMO',{sourceType:kind==='wrong-source'?'fixture':'demo_trial',sourceId:action,instrument:'BTC-EUR',side:kind==='sell-old'?'SELL':'BUY',notional:kind==='oversize'?101:100,
        payloadOverrides:{demoReconciliation:{externalAccountId:'123',feeRate:.001,market:{minimumSize:.00001}},grossExposureSek:2000000,openPositions:5,positions:[{instrumentId:'BTC-EUR',quantity:20,availableQuantity:20}]}});
      await db.exec('reset role');
      const definition=(await db.query('select id from strategy_definitions limit 1')).rows[0].id;
      await db.query('insert into demo_trials(id,account_id,asset_id,strategy_definition_id,instrument_id,enabled,started_at,ends_at) values($1,$2,$3,$4,\'BTC-EUR\',$5,$6,$7)',
        [trial,f.account,asset,definition,kind!=='disabled',started,new Date(Date.now()+(kind==='expired'?-1000:86400000)).toISOString()]);
      await db.exec('set local role service_role');
      await db.query("insert into demo_trial_decisions(id,trial_id,signal_key,decision,reason,evidence) values($1::uuid,$2,$1::text,$3,'fixture','{}')",[action,trial,kind==='sell-old'?'SELL':'BUY']);
      const r=(await db.query('select ledger_payload from risk_ledger_snapshots where id=$1',[f.risk])).rows[0].ledger_payload;
      const ledger={version:'account-ledger-v2',status:kind==='unknown'?'UNKNOWN':'KNOWN',unknownReasons:[],accountId:f.account,baselineAt:started,
        cutoffAt:r.cutoffAt,economicCutoffAt:r.economicCutoffAt,cashSek:kind==='cash'?10:kind==='fees'?100:200,grossExposureSek:kind==='exposure'?150:0,
        dailyRealizedPnlSek:0,openPositions:0,positions:[],pendingOrders:[]};
      await db.query('insert into demo_trial_snapshots(id,trial_id,risk_snapshot_id,ledger_payload) values($1,$2,$3,$4)',[snapshot,trial,f.risk,JSON.stringify(ledger)]);
      f.args[9]=JSON.stringify({...f.check,trialSnapshotId:kind==='wrong-risk'?randomUUID():snapshot});
      if(kind==='kill')await db.query("update execution_controls set kill_switch=true where control_key='global'");
      const result=await authorize(f);
      if(reason)assert.equal(result.reason,reason,kind);else{assert.equal(result.authorized,true);assert.equal((await authorize(f)).authorized,false,'no duplicate claim');}
    }finally{await db.exec('rollback; reset role');}
  }
  console.log('Demo trial SQL: role isolation, account/source binding, old inventory protection, budget/fees/expiry, kill switch and single claim passed.');
}
