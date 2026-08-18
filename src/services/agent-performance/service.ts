import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AGENT_PERFORMANCE_VERSION,
  calculateAgentPerformance,
  consensusDirection,
  qualityBucket,
  type AgentEvaluationPoint,
} from "@/domain/agent-performance";
import { buildConsensus, type NormalizedOpinion } from "@/domain/consensus";
import { deterministicDigest } from "@/domain/events";
import { horizonMs, type ForecastHorizon } from "@/domain/forecast";

interface Group {
  agentId: string;
  agentVersion: string;
  assetClass: string;
  horizon: string;
  marketRegime: string;
  dataQualityBucket: string;
  points: AgentEvaluationPoint[];
  inputIds: string[];
}

export class AgentPerformanceService {
  constructor(private readonly db: SupabaseClient) {}

  async run(cutoff = new Date().toISOString(), limit = 500) {
    const { data: snapshots, error } = await this.db
      .from("consensus_snapshots")
      .select("id,asset_id,horizon,cutoff_at,available_at,result,data_quality,assets(kind)")
      .lte("available_at", cutoff)
      .order("cutoff_at")
      .limit(limit);
    if (error) throw error;
    const snapshotIds = (snapshots ?? []).map((snapshot: any) => snapshot.id);
    if (!snapshotIds.length) return { snapshots: 0, evaluatedOutcomes: 0, groups: 0, created: 0 };

    const [{ data: opinions, error: opinionError }, { data: overlaps, error: overlapError }] = await Promise.all([
      this.db.from("consensus_opinions").select("*").in("consensus_id", snapshotIds),
      this.db.from("consensus_evidence_overlaps").select("*").in("consensus_id", snapshotIds),
    ]);
    if (opinionError) throw opinionError;
    if (overlapError) throw overlapError;

    const groups = new Map<string, Group>();
    let evaluatedOutcomes = 0;
    for (const snapshot of snapshots ?? []) {
      const outcome = await this.outcome(snapshot, cutoff);
      if (!outcome) continue;
      evaluatedOutcomes++;
      const snapshotOpinions = (opinions ?? []).filter((opinion: any) => opinion.consensus_id === snapshot.id);
      const normalized = snapshotOpinions.map((opinion: any) => normalizeStoredOpinion(opinion, snapshot));
      const withDirection = consensusDirection(snapshot.result);
      for (const opinion of snapshotOpinions as any[]) {
        const without = buildConsensus(
          normalized.filter((candidate) => candidate.inputId !== opinion.input_id),
          snapshot.cutoff_at,
        );
        const withoutDirection = consensusDirection(without.state);
        const levels = (overlaps ?? [])
          .filter(
            (overlap: any) =>
              overlap.consensus_id === snapshot.id &&
              (overlap.left_input_id === opinion.input_id || overlap.right_input_id === opinion.input_id),
          )
          .map((overlap: any) => overlap.overlap_level as "LOW" | "MEDIUM" | "HIGH");
        const assetClass = assetKind(snapshot.assets);
        const bucket = qualityBucket(numberOrNull(opinion.data_quality));
        const marketRegime = "UNKNOWN";
        const key = [opinion.agent_id, opinion.agent_version, assetClass, snapshot.horizon, marketRegime, bucket].join("|");
        const group: Group = groups.get(key) ?? {
          agentId: opinion.agent_id,
          agentVersion: opinion.agent_version,
          assetClass,
          horizon: snapshot.horizon,
          marketRegime,
          dataQualityBucket: bucket,
          points: [],
          inputIds: [],
        };
        group.points.push({
          id: `${snapshot.id}:${opinion.input_id}`,
          stance: opinion.stance,
          actualReturn: outcome.actualReturn,
          maxFavorableExcursion: outcome.maxFavorableExcursion,
          maxAdverseExcursion: outcome.maxAdverseExcursion,
          dataQuality: numberOrNull(opinion.data_quality),
          overlapLevels: levels,
          consensusWithCorrect: directionCorrect(withDirection, outcome.actualReturn),
          consensusWithoutCorrect: directionCorrect(withoutDirection, outcome.actualReturn),
        });
        group.inputIds.push(`${snapshot.id}:${opinion.input_id}`);
        groups.set(key, group);
      }
    }

    let created = 0;
    for (const group of groups.values()) {
      const result = calculateAgentPerformance(group.points);
      const snapshotKey = deterministicDigest({
        version: AGENT_PERFORMANCE_VERSION,
        cutoff,
        agentId: group.agentId,
        agentVersion: group.agentVersion,
        assetClass: group.assetClass,
        horizon: group.horizon,
        marketRegime: group.marketRegime,
        dataQualityBucket: group.dataQualityBucket,
        inputHash: result.inputHash,
      });
      const saved = await this.db
        .from("agent_performance_snapshots")
        .upsert(
          {
            snapshot_key: snapshotKey,
            performance_version: AGENT_PERFORMANCE_VERSION,
            agent_id: group.agentId,
            agent_version: group.agentVersion,
            asset_class: group.assetClass,
            horizon: group.horizon,
            market_regime: group.marketRegime,
            data_quality_bucket: group.dataQualityBucket,
            information_cutoff_at: cutoff,
            available_at: new Date(Math.max(Date.now(), Date.parse(cutoff))).toISOString(),
            status: result.status,
            reason: result.reason,
            sample_size: result.sampleSize,
            directional_sample_size: result.directionalSampleSize,
            leave_one_out_sample_size: result.leaveOneOutSampleSize,
            independent_edge: result.independentEdge,
            metrics: result.metrics,
            input_ids: [...group.inputIds].sort(),
            input_hash: result.inputHash,
          },
          { onConflict: "snapshot_key", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (saved.error) throw saved.error;
      if (saved.data) created++;
    }
    return { snapshots: snapshots?.length ?? 0, evaluatedOutcomes, groups: groups.size, created };
  }

  private async outcome(snapshot: any, availableAt: string) {
    const duration = horizonMs(snapshot.horizon as ForecastHorizon);
    if (!duration) return null;
    const target = new Date(Date.parse(snapshot.cutoff_at) + duration).toISOString();
    if (target > availableAt) return null;
    const tolerance = Math.min(900_000, Math.max(60_000, duration * 0.1));
    const end = new Date(Date.parse(target) + tolerance).toISOString();
    const kind = assetKind(snapshot.assets);
    if (kind === "crypto") {
      const [{ data: entry, error: entryError }, { data: path, error: pathError }] = await Promise.all([
        this.db
          .from("crypto_market_observations")
          .select("price_usd,observed_at,ingested_at")
          .eq("asset_id", snapshot.asset_id)
          .lte("observed_at", snapshot.cutoff_at)
          .lte("ingested_at", snapshot.available_at)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.db
          .from("crypto_market_observations")
          .select("price_usd,observed_at,ingested_at")
          .eq("asset_id", snapshot.asset_id)
          .gt("observed_at", snapshot.cutoff_at)
          .lte("observed_at", end)
          .lte("ingested_at", availableAt)
          .order("observed_at"),
      ]);
      if (entryError) throw entryError;
      if (pathError) throw pathError;
      return outcomeFromRows(entry, path ?? [], target);
    }
    // market_prices lacks an ingestion/available timestamp. Using it here would
    // allow later backfills to alter historical agent performance.
    return null;
  }
}

function normalizeStoredOpinion(row: any, snapshot: any): NormalizedOpinion {
  return {
    inputId: row.input_id,
    agentId: row.agent_id,
    agentVersion: row.agent_version,
    assetId: snapshot.asset_id,
    horizon: snapshot.horizon,
    cutoffAt: snapshot.cutoff_at,
    stance: row.stance,
    strength: numberOrNull(row.strength),
    confidence: numberOrNull(row.confidence),
    dataQuality: numberOrNull(row.data_quality),
    evidenceRefs: row.evidence_refs ?? [],
    knowledgeRefs: row.knowledge_refs ?? [],
    evidenceFamilies: row.evidence_families ?? [],
    criticalVeto: row.critical_veto,
  };
}
function outcomeFromRows(entry: any, rows: any[], target: string) {
  const entryPrice = Number(entry?.price_usd ?? entry?.close);
  const usable = rows
    .map((row) => ({ price: Number(row.price_usd ?? row.close), at: row.observed_at ?? row.captured_at }))
    .filter((row) => row.price > 0);
  const exit = usable.find((row) => row.at >= target);
  if (!(entryPrice > 0) || !exit) return null;
  const path = [entryPrice, ...usable.map((row) => row.price)];
  return {
    actualReturn: (exit.price / entryPrice - 1) * 100,
    maxFavorableExcursion: (Math.max(...path) / entryPrice - 1) * 100,
    maxAdverseExcursion: (Math.min(...path) / entryPrice - 1) * 100,
  };
}
function directionCorrect(direction: "BULLISH" | "BEARISH" | null, actualReturn: number) {
  if (!direction) return null;
  return direction === "BULLISH" ? actualReturn > 0 : actualReturn < 0;
}
function assetKind(value: any) {
  const asset = Array.isArray(value) ? value[0] : value;
  return asset?.kind ?? "UNKNOWN";
}
function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
}
