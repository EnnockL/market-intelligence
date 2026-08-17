import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { aggregateQualifications, evaluateQualification, QUALIFICATION_POLICY_V1, type EvidenceRef, type QualificationEvaluation, type RequirementKey } from "@/domain/qualification";

export class QualificationDiagnosticsService {
  constructor(private db: SupabaseClient) {}

  async run(cutoff = new Date().toISOString()) {
    const policy = await this.ensurePolicy();
    const { data: revisions, error } = await this.db.from("jackpot_candidate_revisions")
      .select("*,jackpot_candidates!inner(id,current_state,asset_id)")
      .lte("information_cutoff_at", cutoff).order("information_cutoff_at").order("revision_number");
    if (error) throw error;
    let created = 0;
    const evaluations: QualificationEvaluation[] = [];
    for (const revision of revisions ?? []) {
      const candidate = Array.isArray(revision.jackpot_candidates) ? revision.jackpot_candidates[0] : revision.jackpot_candidates;
      const evaluation = await this.evaluateRevision(candidate, revision);
      evaluations.push(evaluation);
      const { data: saved, error: saveError } = await this.db.from("qualification_evaluations").upsert({
        candidate_id: candidate.id, candidate_revision: revision.revision_number, policy_version: policy,
        information_cutoff_at: revision.information_cutoff_at, evaluated_at: cutoff,
        current_state: revision.state, eligible_next_state: evaluation.eligibleNextState,
        requirements_passed: evaluation.requirementsPassed, requirements_failed: evaluation.requirementsFailed,
        requirements_unknown: evaluation.requirementsUnknown, final_decision: evaluation.finalDecision,
        decision_reason: evaluation.decisionReason, input_hash: evaluation.inputHash,
      }, { onConflict: "candidate_id,candidate_revision,policy_version", ignoreDuplicates: true }).select("id").maybeSingle();
      if (saveError) throw saveError;
      if (saved) {
        const { error: requirementError } = await this.db.from("qualification_requirements").insert(evaluation.requirements.map(r => ({
          evaluation_id: saved.id, requirement_key: r.key, status: r.status, blocker_code: r.blockerCode,
          observed_value: r.observedValue === undefined ? null : r.observedValue,
          required_value: r.requiredValue === undefined ? null : r.requiredValue,
          evidence_refs: r.evidenceRefs, source: r.source, data_quality: r.dataQuality,
          information_cutoff_at: r.cutoff,
        })));
        if (requirementError) throw requirementError;
        created++;
      }
    }
    const latestByCandidate = new Map<string, QualificationEvaluation>();
    (revisions ?? []).forEach((r: any, i: number) => {
      const c = Array.isArray(r.jackpot_candidates) ? r.jackpot_candidates[0] : r.jackpot_candidates;
      latestByCandidate.set(c.id, evaluations[i]);
    });
    const aggregate = aggregateQualifications([...latestByCandidate.values()]);
    const funnel = await this.funnel(cutoff);
    const hash = deterministicDigest({ policy, cutoff, funnel, aggregate });
    const { error: aggregateError } = await this.db.from("qualification_aggregate_snapshots").upsert({
      policy_version: policy, funnel, blocker_frequency: aggregate.blockerFrequency,
      unknown_frequency: aggregate.unknownFrequency, coverage_gaps: aggregate.coverageGaps,
      policy_strictness: aggregate.policyStrictness, information_cutoff_at: cutoff, input_hash: hash,
    }, { onConflict: "input_hash", ignoreDuplicates: true });
    if (aggregateError) throw aggregateError;
    return { revisions: (revisions ?? []).length, created, funnel, aggregate };
  }

  private async ensurePolicy() {
    const { error } = await this.db.from("qualification_policies").upsert({ policy_version: QUALIFICATION_POLICY_V1.version, configuration: QUALIFICATION_POLICY_V1 }, { onConflict: "policy_version", ignoreDuplicates: true });
    if (error) throw error;
    return QUALIFICATION_POLICY_V1.version;
  }

  private async evaluateRevision(candidate: any, revision: any) {
    const cutoff = revision.information_cutoff_at;
    const [{ data: events, error: eventError }, { data: risks, error: riskError }] = await Promise.all([
      this.db.from("event_outbox").select("event_id,event_type,available_at,provider,data_quality,payload").eq("asset_id", candidate.asset_id).lte("available_at", cutoff).order("available_at"),
      this.db.from("token_risk_assessments").select("id,provider,information_available_at,data_quality,rug_status,risk_components").eq("asset_id", candidate.asset_id).lte("information_available_at", cutoff).order("information_available_at", { ascending: false }).limit(1),
    ]);
    if (eventError) throw eventError;
    if (riskError) throw riskError;
    const features = revision.features ?? {}, safety = revision.safety_result?.status ?? null;
    const evidence: Partial<Record<RequirementKey, EvidenceRef[]>> = {};
    const eventRef = (types: string[]) => (events ?? []).filter((e: any) => types.includes(e.event_type)).map((e: any) => ({ type: "event", id: e.event_id, availableAt: e.available_at, source: e.provider, dataQuality: e.data_quality }));
    evidence.price_acceleration = eventRef(["market.price_accelerated"]);
    evidence.volume_acceleration = eventRef(["market.volume_accelerated"]);
    evidence.new_wallet_inflow = eventRef(["market.new_wallet_inflow"]);
    evidence.holder_growth = eventRef(["holder.growth"]);
    evidence.liquidity_evidence = eventRef(["market.liquidity_added", "pool.created"]);
    evidence.wallet_convergence = eventRef(["opportunity.fast_created", "wallet.buy_detected"]);
    const risk = risks?.[0];
    if (risk) evidence.token_risk_coverage = [{ type: "token_risk_assessment", id: risk.id, availableAt: risk.information_available_at, source: risk.provider, dataQuality: risk.data_quality }];
    const riskCoverage = risk ? riskCoveragePercent(risk.risk_components) : null;
    return evaluateQualification({
      candidateId: candidate.id, candidateRevision: revision.revision_number, currentState: revision.state, informationCutoffAt: cutoff,
      safety, dataQuality: number(features.dataQuality), liquidityUsd: number(features.liquidity),
      rawWalletCount: number(features.rawWalletCount), independentWallets: number(features.confirmedIndependent),
      verifiedWallets: number(features.verifiedWalletCount), relationshipCoverage: number(features.relationshipCoverage), riskCoverage,
      priceAcceleration: evidence.price_acceleration.length ? true : null, volumeAcceleration: evidence.volume_acceleration.length ? true : null,
      latenessMs: number(features.latencyFromFirstBuyMs), marketCapUsd: number(features.marketCap), tokenAgeSeconds: number(features.tokenAgeSeconds),
      newWalletInflow: evidence.new_wallet_inflow.length ? true : null, holderGrowth: evidence.holder_growth.length ? true : null,
      holderProviderAvailable: evidence.holder_growth.length > 0, evidence,
    });
  }

  private async funnel(cutoff: string) {
    const { data, error } = await this.db.from("jackpot_candidates").select("current_state").lte("detected_at", cutoff);
    if (error) throw error;
    const states = ["DISCOVERED", "WATCHING", "ACCELERATING", "JACKPOT_CANDIDATE", "QUALIFIED"];
    return Object.fromEntries(states.map(state => [state, (data ?? []).filter((r: any) => r.current_state === state).length]));
  }
}
function number(value: unknown) { const n = Number(value); return value === null || value === undefined || !Number.isFinite(n) ? null : n; }
function riskCoveragePercent(value: any) { const components = value?.components; if (!Array.isArray(components) || !components.length) return null; return Math.round(components.filter((c: any) => c.status && c.status !== "UNKNOWN").length / components.length * 100); }
