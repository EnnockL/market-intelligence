import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyMarketRegime, MARKET_REGIME_POLICY_VERSION, REGIME_POLICY, type RegimeAssetClass, type RegimeObservationPair } from "@/domain/market-regime";
import { createEventEnvelope, deterministicDigest } from "@/domain/events";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

export class MarketRegimeService {
  private readonly transport: PostgresOutboxTransport;
  constructor(private readonly db: SupabaseClient) { this.transport = new PostgresOutboxTransport(db); }

  async run(cutoff = new Date().toISOString()) {
    let created = 0;
    const results = [];
    for (const assetClass of ["stock", "crypto"] as RegimeAssetClass[]) {
      const { data: assets, error } = await this.db.from("assets").select("id").eq("kind", assetClass).eq("is_active", true).order("id");
      if (error) throw error;
      const observations = await this.observations(assetClass, (assets ?? []).map((asset: any) => asset.id), cutoff);
      const result = classifyMarketRegime({ assetClass, evaluatedAt: cutoff, expectedAssets: assets?.length ?? 0, observations });
      const snapshotKey = deterministicDigest({ policy: MARKET_REGIME_POLICY_VERSION, assetClass, cutoff, resultHash: result.resultHash });
      const saved = await this.db.from("market_regime_snapshots").upsert({
        snapshot_key: snapshotKey, policy_version: MARKET_REGIME_POLICY_VERSION, scope: assetClass.toUpperCase(),
        regime: result.regime, reason: result.reason, information_cutoff_at: cutoff,
        available_at: new Date(Math.max(Date.now(), Date.parse(cutoff))).toISOString(), sample_size: result.sampleSize,
        expected_assets: result.expectedAssets, coverage_pct: result.coveragePct, data_quality: result.dataQuality,
        confidence: result.confidence, evidence_refs: result.evidenceRefs, result_hash: result.resultHash,
      }, { onConflict: "snapshot_key", ignoreDuplicates: true }).select("id").maybeSingle();
      if (saved.error) throw saved.error;
      if (saved.data) {
        const snapshotId = saved.data.id;
        const components = [
          ["MEDIAN_RETURN_PCT", result.medianReturnPct], ["POSITIVE_BREADTH_PCT", result.positiveBreadthPct],
          ["DISPERSION_PCT", result.dispersionPct], ["COVERAGE_PCT", result.coveragePct],
        ];
        const componentSave = await this.db.from("market_regime_components").insert(components.map(([code, value]) => ({ snapshot_id: snapshotId, component_code: code, value, status: value === null ? "UNKNOWN" : "AVAILABLE" })));
        if (componentSave.error) throw componentSave.error;
        await this.transport.publish(createEventEnvelope({ eventType: "market.regime_observed", entityType: "market_regime_snapshot", entityId: snapshotId, assetId: null, occurredAt: cutoff, observedAt: cutoff, availableAt: new Date(Math.max(Date.now(), Date.parse(cutoff))).toISOString(), provider: "market-regime-engine", sourceReference: `market-regime:${snapshotKey}`, dataQuality: result.dataQuality ?? 0, confidence: result.confidence, payload: { scope: assetClass.toUpperCase(), regime: result.regime, reason: result.reason, policyVersion: MARKET_REGIME_POLICY_VERSION }, correlationId: snapshotKey, causationId: null }));
        created++;
      }
      results.push({ assetClass, regime: result.regime, reason: result.reason, sampleSize: result.sampleSize, coveragePct: result.coveragePct });
    }
    return { created, results, policyVersion: MARKET_REGIME_POLICY_VERSION };
  }

  private async observations(assetClass: RegimeAssetClass, assetIds: string[], cutoff: string): Promise<RegimeObservationPair[]> {
    if (!assetIds.length) return [];
    const lookback = REGIME_POLICY[assetClass].lookbackMs;
    const from = new Date(Date.parse(cutoff) - lookback - Math.min(lookback, 86_400_000)).toISOString();
    if (assetClass === "crypto") {
      const { data, error } = await this.db.from("crypto_market_observations").select("id,asset_id,provider,price_usd,observed_at,ingested_at").in("asset_id", assetIds).gte("observed_at", from).lte("observed_at", cutoff).lte("ingested_at", cutoff).order("observed_at");
      if (error) throw error;
      return pairRows(data ?? [], cutoff, lookback, "observed_at", "price_usd");
    }
    const { data, error } = await this.db.from("market_prices").select("asset_id,provider,close,captured_at,source_event_id").in("asset_id", assetIds).gte("captured_at", from).lte("captured_at", cutoff).order("captured_at");
    if (error) throw error;
    return pairRows((data ?? []).map((row: any) => ({ ...row, id: row.source_event_id ?? `${row.asset_id}:${row.provider}:${row.captured_at}` })), cutoff, lookback, "captured_at", "close");
  }
}

function pairRows(rows: any[], cutoff: string, lookbackMs: number, timeField: string, priceField: string) {
  const byAsset = new Map<string, any[]>();
  for (const row of rows) { const list = byAsset.get(row.asset_id) ?? []; list.push(row); byAsset.set(row.asset_id, list); }
  const target = new Date(Date.parse(cutoff) - lookbackMs).toISOString();
  const pairs: RegimeObservationPair[] = [];
  for (const [assetId, all] of byAsset) {
    const current = all.at(-1);
    if (!current) continue;
    const sameProvider = all.filter((row) => row.provider === current.provider);
    const beforeTarget = sameProvider.filter((row) => row[timeField] <= target);
    const baseline = beforeTarget.at(-1);
    if (!baseline || !(Number(current[priceField]) > 0) || !(Number(baseline[priceField]) > 0)) continue;
    pairs.push({ assetId, currentPrice: Number(current[priceField]), baselinePrice: Number(baseline[priceField]), currentObservedAt: current[timeField], baselineObservedAt: baseline[timeField], evidenceRefs: [baseline.id, current.id] });
  }
  return pairs;
}
