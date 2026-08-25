import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { AI_EXPLANATION_CONTRACT_VERSION, type AIProvider, type EvidenceReference } from "./provider";

export const AI_EXPLANATION_PROMPT_VERSION = "market-explanation-prompt-v1";

export class AIExplanationService {
  constructor(private readonly db: SupabaseClient, private readonly provider: AIProvider) {}

  async run(cutoff = new Date().toISOString(), limit = 5) {
    const boundedLimit = Math.max(1, Math.min(25, limit));
    const { data, error } = await this.db.from("meta_assessments").select("*,assets(symbol),meta_assessment_requirements(*)").lte("available_at", cutoff).lte("information_cutoff_at", cutoff).order("created_at", { ascending: false }).limit(boundedLimit * 4);
    if (error) throw error;
    let created = 0, skipped = 0;
    for (const assessment of data ?? []) {
      if (created >= boundedLimit) break;
      const explanationKey = deterministicDigest({ contract: AI_EXPLANATION_CONTRACT_VERSION, prompt: AI_EXPLANATION_PROMPT_VERSION, provider: this.provider.name, model: this.provider.model, entityType: "META_ASSESSMENT", entityId: assessment.id, inputHash: assessment.input_hash });
      const existing = await this.db.from("ai_explanations").select("id").eq("explanation_key", explanationKey).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) { skipped++; continue; }
      const requirements = [...(assessment.meta_assessment_requirements ?? [])].sort((a: any, b: any) => String(a.requirement_code).localeCompare(String(b.requirement_code)));
      const evidence: EvidenceReference[] = requirements.map((item: any) => ({ sourceId: `meta-requirement:${item.id}`, observedAt: assessment.information_cutoff_at, availableAt: assessment.available_at, sourceType: "META_REQUIREMENT", excerpt: `${item.requirement_code}: ${item.status}; observed=${JSON.stringify(item.observed_value)}; required=${JSON.stringify(item.required_value)}; blocker=${item.blocker_code ?? "NONE"}` }));
      const asset = Array.isArray(assessment.assets) ? assessment.assets[0] : assessment.assets;
      const request = { entityType: "META_ASSESSMENT" as const, entityId: assessment.id, assetId: assessment.asset_id, assetSymbol: asset?.symbol ?? "UNKNOWN", informationCutoffAt: assessment.information_cutoff_at, deterministicDecision: assessment.decision, deterministicReason: assessment.reason ?? "Requirements evaluated", dataQuality: numberOrNull(assessment.data_quality), context: { horizon: assessment.horizon, policyVersion: assessment.policy_version, readyForPolicyEvaluation: assessment.ready_for_policy_evaluation, requirementsPassed: assessment.requirements_passed, requirementsFailed: assessment.requirements_failed, requirementsUnknown: assessment.requirements_unknown }, evidence };
      const result = await this.provider.explain(request);
      const inputHash = deterministicDigest(request), outputHash = deterministicDigest(result);
      const saved = await this.db.from("ai_explanations").insert({ explanation_key: explanationKey, contract_version: AI_EXPLANATION_CONTRACT_VERSION, entity_type: request.entityType, entity_id: request.entityId, asset_id: request.assetId, information_cutoff_at: request.informationCutoffAt, available_at: new Date().toISOString(), provider: result.provider, model: result.model, prompt_version: AI_EXPLANATION_PROMPT_VERSION, summary: result.summary, reasoning: result.reasoning, risks: result.risks, missing_data: result.missingData, suggested_action: result.suggestedAction, evidence_refs: evidence.map((item) => item.sourceId), input_hash: inputHash, output_hash: outputHash, response_id: result.responseId, usage: result.usage });
      if (saved.error) throw saved.error;
      created++;
    }
    return { evaluated: data?.length ?? 0, created, skipped, provider: this.provider.name, model: this.provider.model, promptVersion: AI_EXPLANATION_PROMPT_VERSION };
  }
}

function numberOrNull(value: unknown) { const number = Number(value); return value == null || !Number.isFinite(number) ? null : number; }
