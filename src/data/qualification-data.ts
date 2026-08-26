import { createServiceClient } from "@/lib/supabase/server";
export async function getQualificationData() {
  try {
    const db = createServiceClient();
    const [{ data: snapshot, error: snapshotError }, { data: evaluations, error: evaluationError }] = await Promise.all([
      db.from("qualification_aggregate_snapshots").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("qualification_evaluations").select("id,candidate_id,candidate_revision,current_state,final_decision,decision_reason,requirements_failed,requirements_unknown,information_cutoff_at,policy_version,jackpot_candidates(assets(symbol)),qualification_requirements(requirement_key,status,blocker_code,evidence_refs)").order("information_cutoff_at", { ascending: false }).limit(12),
    ]);
    if (snapshotError) throw snapshotError; if (evaluationError) throw evaluationError;
    return { mode: "live" as const, policyVersion: snapshot?.policy_version ?? evaluations?.[0]?.policy_version ?? "jackpot-qualification-policy-v2", funnel: snapshot?.funnel ?? {}, blockerFrequency: snapshot?.blocker_frequency ?? {}, unknownFrequency: snapshot?.unknown_frequency ?? {}, cutoff: snapshot?.information_cutoff_at ?? null,
      candidates: (evaluations ?? []).map((e: any) => { const c = Array.isArray(e.jackpot_candidates) ? e.jackpot_candidates[0] : e.jackpot_candidates; const asset = Array.isArray(c?.assets) ? c.assets[0] : c?.assets; return { id: e.candidate_id, evaluationId: e.id, revision: e.candidate_revision, symbol: asset?.symbol ?? "UNKNOWN", state: e.current_state, decision: e.final_decision, reason: e.decision_reason, failed: e.requirements_failed, unknown: e.requirements_unknown, cutoff: e.information_cutoff_at, requirements: e.qualification_requirements ?? [] }; }) };
  } catch { return { mode: "degraded" as const, policyVersion: "jackpot-qualification-policy-v2", funnel: {}, blockerFrequency: {}, unknownFrequency: {}, cutoff: null, candidates: [] }; }
}
