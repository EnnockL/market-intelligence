import { describe, expect, it, vi } from "vitest";
import { MarketRegimeService } from "@/services/market-regime/service";

describe("market regime pagination", () => {
  it("counts every active asset beyond the API row cap and bounds observation queries", async () => {
    const ids = Array.from({ length: 1005 }, (_, i) => String(i).padStart(5, "0"));
    const snapshots: any[] = [];
    const rpc = vi.fn(async (_name, args) => {
      expect(args.p_asset_ids.length).toBeLessThanOrEqual(500);
      return { data: [], error: null };
    });
    const db: any = { rpc, from(table: string) {
      let kind = "", after = "", limit = 500;
      const query: any = {
        select: () => query, eq: (key: string, value: string) => { if (key === "kind") kind = value; return query; },
        order: () => query, limit: (value: number) => { limit = value; return query; },
        gt: (_key: string, value: string) => { after = value; return query; },
        upsert: (value: any) => { snapshots.push(value); return query; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: table === "assets" && kind === "crypto" ? ids.filter(id => id > after).slice(0, limit).map(id => ({ id })) : [], error: null }),
      };
      return query;
    } };
    await new MarketRegimeService(db).run("2026-09-19T00:00:00.000Z");
    expect(rpc.mock.calls.map(call => call[1].p_asset_ids.length)).toEqual([500, 500, 5]);
    expect(snapshots.find(row => row.scope === "CRYPTO")).toMatchObject({ expected_assets: 1005, sample_size: 0, regime: "UNKNOWN" });
  });
});
