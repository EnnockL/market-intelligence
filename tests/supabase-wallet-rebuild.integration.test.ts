import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { WalletRebuildService } from "@/services/wallet-rebuild/service";
import { chunks } from "@/repositories/bounded-read";

const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
suite("resumable wallet rebuild", () => {
  let db: SupabaseClient;
  const wallet = crypto.randomUUID(), provider = `rebuild-${crypto.randomUUID()}`;
  const assets = Array.from({ length: 101 }, () => crypto.randomUUID());
  const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const insert = async (table: string, rows: any[]) => {
      for (const batch of chunks(rows, 500)) {
        const result = await db.from(table).insert(batch);
        if (result.error) throw result.error;
      }
    };
    await insert("wallets", [{ id: wallet, chain: "integration", address: wallet }]);
    await insert("assets", assets.map(id => ({ id, kind: "crypto", symbol: id, name: "rebuild fixture" })));
    await insert("crypto_tokens", assets.map(id => ({ asset_id: id, mint_address: id })));
    const transactions = assets.flatMap(asset_id => Array.from({ length: 50 }, (_, index) => ({
      id: crypto.randomUUID(), wallet_id: wallet, asset_id, transaction_hash: `${asset_id}-${index}`, instruction_index: 0,
      side: index % 2 ? "sell" : "buy", quantity: 1, occurred_at: at(index * 60),
    })));
    await insert("wallet_transactions", transactions);
    await insert("wallet_transaction_enrichments", transactions.map(t => ({ wallet_transaction_id: t.id, provider,
      enrichment_version: "wallet-enrichment-v2", status: "complete", token_price_usd: t.side === "buy" ? 100 : 102,
      sol_price_usd: 100, fee_usd: 1, known_at: at(4000), pricing_completeness: 100, execution_completeness: 100, information_completeness: 100,
    })));
    await insert("crypto_liquidity_snapshots", Array.from({ length: 10001 }, (_, index) => ({
      asset_id: assets[0], pool_address: "fixture", provider, snapshot_key: `${provider}-${index}`, selection_version: "fixture",
      liquidity_usd: 1000 + index, effective_at: at(index / 1000), information_available_at: at(index / 1000), observed_at: at(index / 1000), data_quality: 100,
    })));
    await insert("crypto_liquidity_snapshots", [{ asset_id: assets[0], pool_address: "future", provider,
      snapshot_key: `${provider}-future`, selection_version: "fixture", liquidity_usd: 999999,
      effective_at: at(0), information_available_at: at(0), observed_at: new Date(Date.now() + 86400000).toISOString(), data_quality: 100 }]);
  }, 60000);

  it("resumes >5000 trades, queries >10000 liquidity records exactly and publishes atomically", async () => {
    const service = new WalletRebuildService(db);
    const first = await service.run(wallet, provider);
    expect(first).toMatchObject({ completed: false, completedAssets: 100, totalAssets: 101, cycles: 0 });
    const visible = await db.from("wallet_trade_cycles").select("id", { count: "exact", head: true }).eq("wallet_id", wallet);
    expect(visible.error).toBeNull(); expect(visible.count).toBe(0);
    // A publishing error must roll back every visible table; staged work survives.
    const badDb = { from: db.from.bind(db), rpc: (name: string, args: any) => {
      if (name === "publish_wallet_rebuild") args.p_summary.wallet_scores[0].score = 101;
      return db.rpc(name, args);
    } } as unknown as SupabaseClient;
    await expect(new WalletRebuildService(badDb).run(wallet, provider)).rejects.toMatchObject({ code: "23514" });
    expect((await db.from("wallet_trade_cycles").select("id", { count: "exact", head: true }).eq("wallet_id", wallet)).count).toBe(0);
    expect((await db.from("wallet_metric_snapshots").select("id", { count: "exact", head: true }).eq("wallet_id", wallet)).count).toBe(0);
    const completed = await service.run(wallet, provider);
    expect(completed).toMatchObject({ completed: true, completedAssets: 101, cycles: 2525, jobId: first.jobId });
    expect((await db.from("wallet_trade_cycles").select("id", { count: "exact", head: true }).eq("wallet_id", wallet)).count).toBe(2525);
    const metric = await db.from("wallet_metric_snapshots").select("closed_trades,verified_trades,realized_pnl_usd").eq("wallet_id", wallet).single();
    expect(metric.error).toBeNull(); expect(metric.data).toMatchObject({ closed_trades: 2525, verified_trades: 2525, realized_pnl_usd: 0 });
    const cycle = await db.from("wallet_trade_cycles").select("entry_liquidity_usd,min_liquidity_during_trade_usd,max_liquidity_during_trade_usd")
      .eq("wallet_id", wallet).eq("asset_id", assets[0]).eq("cycle_number", 1).single();
    expect(cycle.error).toBeNull(); expect(cycle.data).toMatchObject({ entry_liquidity_usd: 1000, min_liquidity_during_trade_usd: 1000, max_liquidity_during_trade_usd: 11000 });
    expect((await db.rpc("publish_wallet_rebuild", { p_job: first.jobId, p_summary: {} })).data).toBe(0);
    expect((await db.from("wallet_rebuild_parts").update({ status: "PENDING" }).eq("job_id", first.jobId)).error).not.toBeNull();
  }, 90000);
});
