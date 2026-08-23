import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateMetaReadiness, META_READINESS_POLICY_VERSION } from "@/domain/meta-readiness";
import { createEventEnvelope, deterministicDigest } from "@/domain/events";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

export class MetaReadinessService {
  private readonly transport: PostgresOutboxTransport;
  constructor(private readonly db: SupabaseClient) { this.transport = new PostgresOutboxTransport(db); }
  async run(cutoff = new Date().toISOString()) {
    const [{ data: assessments, error: assessmentError }, { data: groups, error: groupError }] = await Promise.all([
      this.db.from("meta_assessments").select("id,decision,available_at,meta_assessment_requirements(requirement_code,status)").lte("available_at", cutoff).order("created_at", { ascending: false }).limit(1000),
      this.db.from("forecast_performance_snapshots").select("id,horizon,status,sample_size,available_at,forecast_calibration_buckets(status)").lte("available_at", cutoff).order("information_cutoff_at", { ascending: false }).limit(200),
    ]);
    if (assessmentError) throw assessmentError; if (groupError) throw groupError;
    const latestGroups = new Map<string, any>(); for (const group of groups ?? []) { const key = group.horizon; if (!latestGroups.has(key)) latestGroups.set(key, group); }
    const normalizedAssessments = (assessments ?? []).map((item: any) => ({ id: item.id, decision: item.decision, requirements: (item.meta_assessment_requirements ?? []).map((requirement: any) => ({ code: requirement.requirement_code, status: requirement.status })) }));
    const normalizedGroups = [...latestGroups.values()].map((group: any) => ({ id: group.id, horizon: group.horizon, status: group.status, sampleSize: Number(group.sample_size), readyCalibrationBuckets: (group.forecast_calibration_buckets ?? []).filter((bucket: any) => bucket.status === "VALUE").length }));
    const result = calculateMetaReadiness(normalizedAssessments, normalizedGroups);
    const snapshotKey = deterministicDigest({ policy: META_READINESS_POLICY_VERSION, inputHash: result.inputHash });
    const saved = await this.db.from("meta_readiness_snapshots").upsert({ snapshot_key: snapshotKey, policy_version: META_READINESS_POLICY_VERSION, information_cutoff_at: cutoff, available_at: cutoff, status: result.status, assessment_count: result.assessmentCount, decision_coverage_pct: result.decisionCoveragePct, ready_horizons: result.readyHorizons, calibrated_horizons: result.calibratedHorizons, blockers: result.blockers, input_assessment_ids: normalizedAssessments.map((item) => item.id).sort(), input_performance_ids: normalizedGroups.map((item) => item.id).sort(), input_hash: result.inputHash, result_hash: result.resultHash }, { onConflict: "snapshot_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (saved.error) throw saved.error; if (!saved.data) return { created: 0, status: result.status, blockers: result.blockers, assessmentCount: result.assessmentCount, policyVersion: META_READINESS_POLICY_VERSION };
    const snapshotId = saved.data.id;
    const components = await this.db.from("meta_readiness_requirements").insert(result.requirements.map((item) => ({ snapshot_id: snapshotId, requirement_code: item.code, status: item.status, observed_value: item.observed, required_value: item.required, reason: item.reason })));
    if (components.error) throw components.error;
    await this.transport.publish(createEventEnvelope({ eventType: "meta.readiness_observed", entityType: "meta_readiness_snapshot", entityId: snapshotId, assetId: null, occurredAt: cutoff, observedAt: cutoff, availableAt: cutoff, provider: "meta-readiness-engine", sourceReference: `meta-readiness:${snapshotKey}`, dataQuality: result.decisionCoveragePct ?? 0, confidence: null, payload: { status: result.status, blockers: result.blockers, policyVersion: META_READINESS_POLICY_VERSION }, correlationId: snapshotKey, causationId: null }));
    return { created: 1, status: result.status, blockers: result.blockers, assessmentCount: result.assessmentCount, policyVersion: META_READINESS_POLICY_VERSION };
  }
}
