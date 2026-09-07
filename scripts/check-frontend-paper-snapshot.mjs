/** Isolated PostgreSQL checks only. Caller owns the memory-only database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkFrontendPaperSnapshot(db) {
  const signature = "public.frontend_paper_snapshot_v1()";
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed, false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') allowed", [signature])).rows[0].allowed, true);
  const definition = (await db.query("select p.provolatile,p.prosecdef,l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=$1::regprocedure", [signature])).rows[0];
  assert.deepEqual(definition, { provolatile: "s", prosecdef: false, lanname: "sql" }, "same-snapshot SQL/STABLE read model, not a privileged writer");
  await db.exec("set role anon");
  await assert.rejects(db.query("select public.frontend_paper_snapshot_v1()"), error => error.code === "42501");
  await db.exec("reset role; begin");
  try {
    const a = randomUUID(), b = randomUUID(), privateId = randomUUID(), asset = randomUUID(), positionA = randomUUID();
    await db.query("insert into public.assets(id,kind,symbol,name) values($1,'crypto',$2,'Paper snapshot SQL fixture')", [asset, `paper-${asset}`]);
    await db.query(`insert into public.paper_portfolios(id,name,strategy,initial_capital_sek,cash_sek,assumptions,portfolio_scope,created_at) values
      ($1,'Snapshot A','fixture',10000,9000,'{}','SYSTEM_RESEARCH','2026-01-01'),
      ($2,'Snapshot B','fixture',5000,5100,'{}','SYSTEM_RESEARCH','2026-01-02'),
      ($3,'Private portfolio never returned','fixture',1000,'NaN','{}','USER','2026-01-01')`, [a, b, privateId]);
    await db.query(`insert into public.paper_positions(id,portfolio_id,asset_id,quantity,average_entry_price,opened_at,current_price,market_value,realized_pnl,unrealized_pnl,closed_at) values
      ($1,$2,$4,2,500,'2026-01-02',500,1000,0,0,null),
      (gen_random_uuid(),$3,$4,0,100,'2026-01-03',110,0,100,0,'2026-01-04')`, [positionA, a, b, asset]);
    const snapshot = async () => {
      await db.exec("set local role service_role");
      try { return (await db.query("select public.frontend_paper_snapshot_v1() result")).rows[0].result; }
      finally { await db.exec("reset role"); }
    };
    const initial = await snapshot();
    assert.equal(initial.version, "frontend-paper-snapshot-v1");
    assert.equal(initial.status, "READY");
    assert.equal(initial.reason, null);
    assert.equal(initial.portfolios.length, 2);
    assert.equal(initial.portfolios.some(row => row.id === privateId), false, "private invalid balances cannot leak or degrade system research");
    const rowA = initial.portfolios.find(row => row.id === a), rowB = initial.portfolios.find(row => row.id === b);
    assert.equal(rowA.cash, 9000); assert.equal(rowA.equity, 10000); assert.equal(rowA.returnPct, 0); assert.equal(rowA.openPositions, 1);
    assert.equal(rowB.equity, 5100); assert.equal(rowB.realizedPnl, 100); assert.equal(rowB.closedTrades, 1);
    for (const row of initial.portfolios) for (const key of ["positions", "paper_positions", "orders", "performance_snapshots", "user_id"]) assert.equal(key in row, false);

    // Before and after a completed sale have the same equity. The loader now
    // consumes this one DTO, not old cash combined with newer closed positions.
    await db.query("update public.paper_portfolios set cash_sek=10000 where id=$1", [a]);
    await db.query("update public.paper_positions set quantity=0,market_value=0,closed_at='2026-01-05' where id=$1", [positionA]);
    const after = (await snapshot()).portfolios.find(row => row.id === a);
    assert.equal(after.cash, 10000); assert.equal(after.equity, 10000); assert.equal(after.openPositions, 0);

    await db.exec("savepoint before_volume");
    await db.query(`insert into public.paper_positions(portfolio_id,asset_id,quantity,average_entry_price,opened_at,current_price,market_value)
      select $1,$2,1,1,'2026-02-01'::timestamptz+n*interval '1 second',1,1 from generate_series(1,1001)n`, [a, asset]);
    const many = (await snapshot()).portfolios.find(row => row.id === a);
    assert.equal(many.openPositions, 1001, "aggregate is not capped by the PostgREST default page size");
    assert.equal(many.equity, 11001);
    await db.query(`insert into public.paper_positions(portfolio_id,asset_id,quantity,average_entry_price,opened_at,current_price,market_value)
      select $1,$2,1,1,'2026-02-01'::timestamptz+n*interval '1 second',1,1 from generate_series(1002,5000)n`, [a, asset]);
    const capped = await snapshot();
    assert.equal(capped.status, "UNAVAILABLE"); assert.equal(capped.reason, "READ_BUDGET_EXCEEDED");
    assert.deepEqual(capped.portfolios, [], "never return partial monetary totals when the bounded scan is incomplete");
    await db.exec("rollback to savepoint before_volume");

    await db.query("update public.paper_positions set quantity=2,closed_at=null,current_price=null,market_value=0 where id=$1", [positionA]);
    const unknown = await snapshot();
    assert.equal(unknown.reason, "VALUATION_UNAVAILABLE"); assert.deepEqual(unknown.portfolios, []);
    await db.query("update public.paper_positions set current_price='NaN' where id=$1", [positionA]);
    assert.equal((await snapshot()).reason, "VALUATION_UNAVAILABLE", "NaN must not satisfy positive-value checks");
    await db.query(`insert into public.paper_portfolios(name,strategy,initial_capital_sek,cash_sek,assumptions,portfolio_scope)
      select 'Budget '||n,'fixture',100,100,'{}','SYSTEM_RESEARCH' from generate_series(1,19)n`);
    const tooMany = await snapshot();
    assert.equal(tooMany.reason, "READ_BUDGET_EXCEEDED"); assert.deepEqual(tooMany.portfolios, []);
    console.log("Passed: one-snapshot paper summaries, service-only/system-only scope, >1000 complete positions, exact closed PnL, hard scan caps and unknown valuation.");
  } finally { await db.exec("reset role; rollback"); }
}
