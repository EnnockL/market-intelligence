import type { SupabaseClient } from "@supabase/supabase-js";
import { assessMeta, META_AGENT_POLICY_VERSION, type MetaPerformanceInput } from "@/domain/meta-agent";
import { createEventEnvelope, deterministicDigest } from "@/domain/events";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

export class MetaAgentService {
  private readonly transport: PostgresOutboxTransport;
  constructor(private readonly db: SupabaseClient) { this.transport = new PostgresOutboxTransport(db); }

  async run(cutoff = new Date().toISOString(), limit = 100) {
    const { data: snapshots, error } = await this.db.from("consensus_snapshots").select("*").lte("available_at", cutoff).lte("cutoff_at", cutoff).order("cutoff_at", { ascending: false }).limit(limit);
    if (error) throw error;
    const latest = new Map<string, any>();
    for (const row of snapshots ?? []) { const key = `${row.asset_id}:${row.horizon}`; if (!latest.has(key)) latest.set(key, row); }
    let created = 0, watched = 0, rejected = 0, insufficient = 0;
    for (const consensus of latest.values()) {
      const [{ data: asset, error: assetError }, { data: opinions, error: opinionError }] = await Promise.all([
        this.db.from("assets").select("kind").eq("id", consensus.asset_id).single(),
        this.db.from("consensus_opinions").select("agent_id").eq("consensus_id", consensus.id),
      ]);
      if (assetError) throw assetError; if (opinionError) throw opinionError;
      const expectedAgentIds = [...new Set((opinions ?? []).map((row: any) => String(row.agent_id)))].sort();
      const scope = asset.kind === "crypto" ? "CRYPTO" : "STOCK";
      const { data: regime, error: regimeError } = await this.db.from("market_regime_snapshots").select("*").eq("scope", scope).lte("available_at", cutoff).lte("information_cutoff_at", cutoff).order("information_cutoff_at", { ascending: false }).limit(1).maybeSingle();
      if (regimeError) throw regimeError;
      let performance: any[] = [];
      if (expectedAgentIds.length) {
        const response = await this.db.from("agent_performance_snapshots").select("*").in("agent_id", expectedAgentIds).eq("asset_class", asset.kind).eq("horizon", consensus.horizon).lte("available_at", cutoff).lte("information_cutoff_at", cutoff).order("information_cutoff_at", { ascending: false });
        if (response.error) throw response.error;
        const byAgent = new Map<string, any>(); for (const row of response.data ?? []) if (!byAgent.has(row.agent_id)) byAgent.set(row.agent_id, row); performance = [...byAgent.values()];
      }
      const result = assessMeta({ assetId: consensus.asset_id, horizon: consensus.horizon, informationCutoffAt: cutoff,
        consensus: { id: consensus.id, availableAt: consensus.available_at, result: consensus.result, confidence: numberOrNull(consensus.confidence), conflictLevel: consensus.conflict_level, criticalVetoAgent: consensus.critical_veto_agent, independentEvidenceGroups: Number(consensus.independent_evidence_groups), dataQuality: numberOrNull(consensus.data_quality) },
        regime: regime ? { id: regime.id, availableAt: regime.available_at, regime: regime.regime, confidence: numberOrNull(regime.confidence) } : null,
        performance: performance.map(toPerformance), expectedAgentIds });
      const assessmentKey = deterministicDigest({ policy: META_AGENT_POLICY_VERSION, assetId: consensus.asset_id, horizon: consensus.horizon, inputRefs: result.inputRefs });
      const saved = await this.db.from("meta_assessments").upsert({ assessment_key: assessmentKey, policy_version: META_AGENT_POLICY_VERSION, asset_id: consensus.asset_id, horizon: consensus.horizon, information_cutoff_at: cutoff, available_at: cutoff, decision: result.decision, reason: result.reason, consensus_snapshot_id: consensus.id, market_regime_snapshot_id: regime?.id ?? null, input_performance_ids: performance.map((row) => row.id).sort(), requirements_passed: result.requirementsPassed, requirements_failed: result.requirementsFailed, requirements_unknown: result.requirementsUnknown, ready_for_policy_evaluation: result.readyForPolicyEvaluation, data_quality: result.dataQuality, input_hash: result.inputHash, result_hash: result.resultHash }, { onConflict: "assessment_key", ignoreDuplicates: true }).select("id").maybeSingle();
      if (saved.error) throw saved.error; if (!saved.data) continue;
      const assessmentId = saved.data.id;
      const requirementSave = await this.db.from("meta_assessment_requirements").insert(result.requirements.map((item) => ({ assessment_id: assessmentId, requirement_code: item.code, status: item.status, observed_value: item.observedValue, required_value: item.requiredValue, blocker_code: item.blockerCode, evidence_refs: item.evidenceRefs })));
      if (requirementSave.error) throw requirementSave.error;
      await this.transport.publish(createEventEnvelope({ eventType: "meta.assessment_created", entityType: "meta_assessment", entityId: assessmentId, assetId: consensus.asset_id, occurredAt: cutoff, observedAt: cutoff, availableAt: cutoff, provider: "meta-agent-foundation", sourceReference: `meta-assessment:${assessmentKey}`, dataQuality: result.dataQuality ?? 0, confidence: null, payload: { decision: result.decision, reason: result.reason, readyForPolicyEvaluation: result.readyForPolicyEvaluation, policyVersion: META_AGENT_POLICY_VERSION }, correlationId: consensus.asset_id, causationId: consensus.id }));
      created++; if (result.decision === "WATCH") watched++; else if (result.decision === "REJECT") rejected++; else insufficient++;
    }
    return { evaluated: latest.size, created, watched, rejected, insufficient, policyVersion: META_AGENT_POLICY_VERSION };
  }
}

function numberOrNull(value: unknown) { const number = Number(value); return value == null || !Number.isFinite(number) ? null : number; }
function toPerformance(row: any): MetaPerformanceInput { return { id: row.id, agentId: row.agent_id, availableAt: row.available_at, status: row.status, independentEdge: row.independent_edge, incrementalValue: row.metrics?.incrementalValue?.status === "VALUE" ? { status: "VALUE", value: Number(row.metrics.incrementalValue.value) } : { status: "INSUFFICIENT_DATA", value: null } }; }
