import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BASELINE_FORECAST_VERSION } from "@/domain/baseline-forecast";
import { BaselineForecastService } from "@/services/baseline-forecast/service";

// vitest.config enforces a distinct write-enabled Supabase test project.
const suite = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;
suite("Supabase baseline forecast v2", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); });
  it("commits a traceable insufficient stock bundle with immutable input evidence", async () => {
    const assetId = randomUUID(), sourceId = randomUUID();
    const cutoff = new Date().toISOString();
    const asset = await db.from("assets").insert({ id: assetId, kind: "stock", symbol: `BASELINE_TEST_${assetId}`, name: "Isolated baseline fixture" });
    expect(asset.error).toBeNull();
    const source = await db.from("forecasts").insert({
      id: sourceId, forecast_key: `baseline-test:${sourceId}`, asset_id: assetId,
      forecast_version: "forecast-infrastructure-v1", forecast_method: "INSUFFICIENT_DATA",
      model_version: "none", feature_set_version: "forecast-features-v1", information_cutoff_at: cutoff,
      available_at: cutoff, horizon: "30m", status: "INSUFFICIENT_DATA", reason: "INTEGRATION_TARGET", evidence_refs: [], agent_inputs: {},
    });
    expect(source.error).toBeNull();
    await new BaselineForecastService(db).run(cutoff);
    const baseline = await db.from("forecasts").select("id,status,expected_return,agent_inputs")
      .eq("asset_id", assetId).eq("forecast_version", BASELINE_FORECAST_VERSION).single();
    expect(baseline.error).toBeNull();
    expect(baseline.data).toMatchObject({ status: "INSUFFICIENT_DATA", expected_return: null, agent_inputs: { sampleSize: 0, sourceForecastId: sourceId } });
    const id = baseline.data!.id;
    const snapshot = await db.from("baseline_feature_snapshots").select("id").eq("forecast_id", id).single();
    expect(snapshot.error).toBeNull();
    expect((await db.from("baseline_forecast_bundles").select("forecast_id").eq("forecast_id", id).single()).error).toBeNull();
    expect((await db.from("event_outbox").select("event_id").eq("entity_id", id).eq("event_type", "forecast.baseline_created").single()).error).toBeNull();
    const mutation = await db.from("baseline_feature_snapshots").update({ data_quality: 100 }).eq("id", snapshot.data!.id);
    expect(mutation.error?.message).toContain("immutable");
  }, 30_000);
});
