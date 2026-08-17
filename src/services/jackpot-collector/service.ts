import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventEnvelope } from "@/domain/events";
import { deterministicDigest } from "@/domain/events";
import {
  collectorKey,
  JACKPOT_COLLECTOR_VERSION,
  nextJackpotState,
} from "@/domain/jackpot-candidate";
export class JackpotCollectorService {
  constructor(private db: SupabaseClient) {}
  async handle(event: EventEnvelope) {
    if (
      !event.assetId ||
      ![
        "wallet.buy_detected",
        "token.created",
        "pool.created",
        "opportunity.fast_created",
        "market.liquidity_added",
        "market.liquidity_removed",
        "market.volume_accelerated",
        "market.price_accelerated",
        "market.new_wallet_inflow",
        "holder.growth",
      ].includes(event.eventType)
    )
      return { status: "ignored" as const };
    const cutoff = event.availableAt,
      windowStart = new Date(
        Math.floor(Date.parse(event.occurredAt) / 3_600_000) * 3_600_000,
      ).toISOString(),
      key = collectorKey(event.assetId, "jackpot-v1", windowStart);
    let { data: candidate, error } = await this.db
      .from("jackpot_candidates")
      .select("*")
      .eq("candidate_key", key)
      .maybeSingle();
    if (error) throw error;
    if (candidate && Date.parse(cutoff) < Date.parse(candidate.detected_at))
      return { status: "out_of_order" as const, candidateId: candidate.id };
    const features = await this.features(event.assetId, cutoff, event);
    const safety =
      features.riskStatus === "CONFIRMED_RUG" ||
      features.riskStatus === "HIGH_RISK"
        ? "FAIL"
        : features.riskStatus === "UNKNOWN"
          ? "UNKNOWN"
          : "PASS";
    const state = nextJackpotState(
      candidate?.current_state ?? "DISCOVERED",
      event.eventType,
      safety,
      features.dataQuality,
    );
    if (!candidate) {
      const inserted = await this.db
        .from("jackpot_candidates")
        .insert({
          candidate_key: key,
          asset_id: event.assetId,
          strategy: "jackpot-v1",
          active_window_start: windowStart,
          detected_at: cutoff,
          current_state: state,
          collector_version: JACKPOT_COLLECTOR_VERSION,
          created_from_event_id: event.eventId,
          expires_at: new Date(
            Date.parse(windowStart) + 86_400_000,
          ).toISOString(),
        })
        .select("*")
        .single();
      if (inserted.error) throw inserted.error;
      candidate = inserted.data;
    }
    const revisionType = event.eventType.includes("accelerated")
        ? "v1_acceleration"
        : candidate.current_revision
          ? "v2_wallet_enrichment"
          : "v0_detection",
      hash = deterministicDigest({
        candidate: candidate.id,
        event: event.eventId,
        cutoff,
        features,
        state,
      });
    const existing = await this.db
      .from("jackpot_candidate_revisions")
      .select("id")
      .eq("candidate_id", candidate.id)
      .eq("revision_hash", hash)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data)
      return { status: "duplicate" as const, candidateId: candidate.id };
    const revision = Number(candidate.current_revision) + 1;
    const saved = await this.db
      .from("jackpot_candidate_revisions")
      .insert({
        candidate_id: candidate.id,
        revision_number: revision,
        revision_type: revisionType,
        state,
        trigger_event_id: event.eventId,
        information_cutoff_at: cutoff,
        available_at: new Date().toISOString(),
        features,
        probability_features: {
          walletQuality: features.medianWalletScore,
          walletIndependence: features.clusterAdjustedCount,
          convergenceStrength: features.verifiedWalletCount,
          timeCompression: features.convergenceWindowMs,
        },
        payoff_features: {
          marketCap: features.marketCap,
          liquidity: features.liquidity,
          tokenAgeSeconds: features.tokenAgeSeconds,
        },
        safety_result: { status: safety, riskStatus: features.riskStatus },
        revision_hash: hash,
      });
    if (saved.error) throw saved.error;
    const updated = await this.db
      .from("jackpot_candidates")
      .update({ current_state: state, current_revision: revision })
      .eq("id", candidate.id);
    if (updated.error) throw updated.error;
    return { status: "collected" as const, candidateId: candidate.id, state };
  }
  private async features(
    assetId: string,
    cutoff: string,
    event: EventEnvelope,
  ) {
    const [{ data: market }, { data: risk }, { data: snapshot }] =
      await Promise.all([
        this.db
          .from("crypto_market_observations")
          .select("*")
          .eq("asset_id", assetId)
          .lte("observed_at", cutoff)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.db
          .from("token_risk_assessments")
          .select("*")
          .eq("asset_id", assetId)
          .lte("information_available_at", cutoff)
          .order("information_available_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.db
          .from("wallet_cluster_snapshots")
          .select("*")
          .lte("available_at", cutoff)
          .order("available_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    const first = Number(
        (event.payload as any)?.priceUsd ?? market?.price_usd ?? NaN,
      ),
      price = Number.isFinite(first) ? first : null;
    return {
      price,
      marketCap: num(market?.market_cap_usd),
      liquidity: num(market?.liquidity_usd),
      volume: num(market?.volume_24h_usd),
      tokenAgeSeconds: null,
      rawWalletCount: snapshot?.raw_wallet_count ?? null,
      confirmedIndependent:
        snapshot?.status === "available"
          ? snapshot.confirmed_independent_count
          : null,
      relationshipCoverage: num(snapshot?.relationship_coverage),
      clusterAdjustedCount:
        snapshot?.status === "available"
          ? num(snapshot.cluster_adjusted_count)
          : null,
      verifiedWalletCount: null,
      medianWalletScore: null,
      netInflow: null,
      convergenceWindowMs: null,
      riskStatus: risk?.rug_status ?? "UNKNOWN",
      dataQuality: Math.round(
        [
          market ? Number(market.confidence) : 0,
          risk ? Number(risk.data_quality) : 0,
          snapshot ? Number(snapshot.data_quality) : 0,
        ].reduce((a, b) => a + b, 0) / 3,
      ),
      priceAtFirstWalletEntry: num((event.payload as any)?.priceUsd),
      priceAtDetection: price,
      latencyFromFirstBuyMs: Math.max(
        0,
        Date.parse(cutoff) - Date.parse(event.occurredAt),
      ),
      latencyFromConvergenceMs: null,
    };
  }
}
function num(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n)
    ? null
    : n;
}
