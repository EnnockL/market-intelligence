import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
let db: SupabaseClient;

suite("continuous ingestion scheduler", () => {
  beforeAll(() => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  it("registers the ingestion chain before downstream research", async () => {
    const expected = ["WALLET_INGESTION", "CRYPTO_MARKET", "STOCK_INGESTION", "WALLET_DISCOVERY", "MARKET_EVENTS", "FAST_FLOW", "JACKPOT_COLLECTOR"];
    const { data, error } = await db.from("scheduled_jobs").select("job_type,priority,status").in("job_type", expected).order("priority");
    expect(error).toBeNull();
    // Runtime fairness now claims the most overdue job first. Priority remains
    // metadata, not a strict execution order, so assert registration as a set.
    expect(data).toHaveLength(expected.length);
    expect(data?.map((job) => job.job_type)).toEqual(expect.arrayContaining(expected));
    expect(data?.every((job) => job.status !== "PAUSED")).toBe(true);
  });

  it("keeps every ingestion cadence bounded", async () => {
    const { data, error } = await db.from("scheduled_jobs").select("job_type,interval_seconds,lease_seconds").in("job_type", ["WALLET_INGESTION", "CRYPTO_MARKET", "STOCK_INGESTION", "WALLET_DISCOVERY", "MARKET_EVENTS", "FAST_FLOW", "JACKPOT_COLLECTOR"]);
    expect(error).toBeNull();
    expect(data).toHaveLength(7);
    expect(data?.every((job) => job.interval_seconds >= 60 && job.lease_seconds >= 120)).toBe(true);
  });
});
