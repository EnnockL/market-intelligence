import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MarketRegimeService } from "@/services/market-regime/service";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
let db: SupabaseClient;

suite("Supabase market regime v1", () => {
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("creates deterministic snapshots idempotently", async () => {
    const cutoff = new Date(Date.now() - 60_000).toISOString(), service = new MarketRegimeService(db);
    const first = await service.run(cutoff), second = await service.run(cutoff);
    expect(first.results).toHaveLength(2);
    expect(second.created).toBe(0);
    const { data, error } = await db.from("market_regime_snapshots").select("regime,confidence,evidence_refs").eq("information_cutoff_at", cutoff).eq("policy_version", "market-regime-policy-v1").in("scope", ["STOCK", "CRYPTO"]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.every((row: any) => row.regime !== "UNKNOWN" || row.confidence === null)).toBe(true);
  }, 30_000);
  it("keeps regime history immutable", async () => {
    const { data } = await db.from("market_regime_snapshots").select("id").limit(1).maybeSingle();
    if (!data) return;
    const result = await db.from("market_regime_snapshots").update({ regime: "RISK_ON" }).eq("id", data.id);
    expect(result.error?.message).toContain("immutable");
  });
});
