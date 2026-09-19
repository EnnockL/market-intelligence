import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkWalletRebuild(db) {
  await db.exec('reset role; begin');
  try {
    const wallet=randomUUID(), assets=[randomUUID(),randomUUID()];
    const reject=async(fn,pattern)=>{await db.exec('savepoint rejected');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}};
    await db.query("insert into wallets(id,chain,address) values($1::uuid,'test',$1::text)",[wallet]);
    for (const asset of assets) {
      await db.query("insert into assets(id,kind,symbol,name) values($1::uuid,'crypto',$1::text,'batch fixture')",[asset]);
      await db.query("insert into crypto_tokens(asset_id,mint_address) values($1::uuid,$1::text)",[asset]);
      await db.query("insert into wallet_transactions(wallet_id,asset_id,transaction_hash,side,quantity,occurred_at) values($1::uuid,$2::uuid,$2::text,'buy',1,now()-interval '1 day')",[wallet,asset]);
    }
    await db.exec('set local role anon');
    await reject(()=>db.query('select * from wallet_rebuild_jobs'),/permission denied/);
    await reject(()=>db.query("select start_wallet_rebuild($1,'fixture','weighted-average-v2')",[wallet]),/permission denied/);
    await db.exec('set local role service_role');
    await reject(()=>db.query("select insert_wallet_rebuild_rows('wallet_scores','[]')"),/permission denied/);
    const job=(await db.query("select (start_wallet_rebuild($1,'fixture','weighted-average-v2')).*",[wallet])).rows[0];
    assert.equal(job.expected_assets,2);
    assert.equal((await db.query("select (start_wallet_rebuild($1,'fixture','weighted-average-v2')).id id",[wallet])).rows[0].id,job.id);
    await reject(()=>db.query("select publish_wallet_rebuild($1,'{}')",[job.id]),/REBUILD_INCOMPLETE/);
    const first=(await db.query('select * from claim_wallet_rebuild_parts($1,1)',[job.id])).rows[0];
    const second=(await db.query('select * from claim_wallet_rebuild_parts($1,1)',[job.id])).rows[0];
    assert.notEqual(first.asset_id,second.asset_id);
    assert.equal((await db.query('select * from claim_wallet_rebuild_parts($1,1)',[job.id])).rows.length,0,'leased parts cannot be claimed twice');
    await db.exec('reset role');
    await db.query("update wallet_rebuild_parts set lease_until=now()-interval '1 second' where job_id=$1 and asset_id=$2",[job.id,first.asset_id]);
    await db.exec('set local role service_role');
    const recovered=(await db.query('select * from claim_wallet_rebuild_parts($1,1)',[job.id])).rows[0];
    assert.equal(recovered.asset_id,first.asset_id); assert.notEqual(recovered.lease_token,first.lease_token);
    const payload={assetId:first.asset_id,leaseToken:first.lease_token,payload:{rows:[],cycles:[]}};
    await reject(()=>db.query('select save_wallet_rebuild_parts($1,$2)',[job.id,JSON.stringify([payload])]),/REBUILD_LEASE_LOST/);
    payload.leaseToken=recovered.lease_token;
    assert.equal((await db.query('select save_wallet_rebuild_parts($1,$2) n',[job.id,JSON.stringify([payload])])).rows[0].n,1);
    await reject(()=>db.query('select save_wallet_rebuild_parts($1,$2)',[job.id,JSON.stringify([payload])]),/REBUILD_LEASE_LOST/);
    assert.equal((await db.query('select count(*)::int n from wallet_trade_cycles where wallet_id=$1',[wallet])).rows[0].n,0,'checkpoint never exposes partial cycles');
    console.log('Wallet rebuild SQL: private roles, fixed run reuse, disjoint leases, crash recovery, stale-token rejection and incomplete-publication guard passed.');
  } finally { await db.exec('rollback; reset role'); }
}
