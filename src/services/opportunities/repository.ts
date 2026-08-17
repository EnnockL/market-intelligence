import type { SupabaseClient } from "@supabase/supabase-js";
import { opportunityIdempotencyKey, opportunityRevisionKey, validateOpportunityRevision, type OpportunityRevisionInput } from "@/domain/opportunities";

export class OpportunityRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: { opportunityId: string; assetId: string; opportunityType: string; detectedAt: string; createdFromEventId: string; policyVersion: string }) {
    const opportunityKey = opportunityIdempotencyKey({ assetId: input.assetId, opportunityType: input.opportunityType, createdFromEventId: input.createdFromEventId });
    const { data, error } = await this.db.rpc("create_opportunity_v1", { p_opportunity_id: input.opportunityId, p_opportunity_key: opportunityKey,
      p_asset_id: input.assetId, p_opportunity_type: input.opportunityType, p_detected_at: input.detectedAt,
      p_created_from_event_id: input.createdFromEventId, p_policy_version: input.policyVersion });
    if (error) throw error; return data as string;
  }

  async appendRevision(input: OpportunityRevisionInput & { opportunityScore: number; riskScore: number | null; dataQuality: number }) {
    const revision = validateOpportunityRevision(input); const revisionKey = opportunityRevisionKey(input);
    const { data, error } = await this.db.rpc("append_opportunity_revision_v1", { p_opportunity_id: input.opportunityId,
      p_revision_key: revisionKey, p_revision_type: input.revisionType, p_next_state: input.nextState, p_created_at: input.createdAt,
      p_information_cutoff_at: input.informationCutoffAt, p_trigger_event_id: input.triggerEventId,
      p_evidence_ids: revision.evidenceRefs.map((item) => item.evidenceId), p_agent_outputs: input.agentOutputs, p_safety_result: input.safetyResult,
      p_opportunity_score: input.opportunityScore, p_risk_score: input.riskScore, p_data_quality: input.dataQuality });
    if (error) throw error; return Boolean(data);
  }
}
