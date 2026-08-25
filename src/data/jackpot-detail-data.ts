import { createServiceClient } from "@/lib/supabase/server";

export async function getJackpotDetail(id: string) {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("jackpot_candidates")
      .select(
        "*,assets(symbol,name),jackpot_candidate_revisions(*),jackpot_candidate_outcomes(*),qualification_evaluations(*,qualification_requirements(*))",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { data: null, error: null };
    const asset = Array.isArray(data.assets) ? data.assets[0] : data.assets;
    const revisions = [...(data.jackpot_candidate_revisions ?? [])].sort(
      (a: any, b: any) => a.revision_number - b.revision_number,
    );
    const outcomes = [...(data.jackpot_candidate_outcomes ?? [])].sort(
      (a: any, b: any) =>
        b.information_cutoff_at.localeCompare(a.information_cutoff_at),
    );
    const qualifications = [...(data.qualification_evaluations ?? [])].sort((a: any,b: any)=>b.candidate_revision-a.candidate_revision);
    return {
      data: {
        id: data.id,
        symbol: asset?.symbol ?? "UNKNOWN",
        name: asset?.name ?? null,
        state: data.current_state,
        detectedAt: data.detected_at,
        expiresAt: data.expires_at,
        revision: data.current_revision,
        sourceEventId: data.created_from_event_id,
        collectorVersion: data.collector_version,
        revisions: revisions.map((r: any) => ({
          number: r.revision_number,
          type: r.revision_type,
          state: r.state,
          cutoff: r.information_cutoff_at,
          availableAt: r.available_at,
          triggerEventId: r.trigger_event_id,
          features: r.features ?? {},
          safety: r.safety_result ?? {},
          evidence: r.evidence_refs ?? [],
        })),
        outcome: outcomes[0]
          ? {
              maxMultiple: number(outcomes[0].max_multiple),
              mfe: number(outcomes[0].mfe),
              mae: number(outcomes[0].mae),
              quality: outcomes[0].data_quality,
              cutoff: outcomes[0].information_cutoff_at,
            }
          : null,
        qualification: qualifications[0] ? { revision: qualifications[0].candidate_revision, policyVersion: qualifications[0].policy_version, decision: qualifications[0].final_decision, reason: qualifications[0].decision_reason, cutoff: qualifications[0].information_cutoff_at, requirements: [...(qualifications[0].qualification_requirements ?? [])].sort((a:any,b:any)=>a.requirement_key.localeCompare(b.requirement_key)).map((r:any)=>({ key:r.requirement_key,status:r.status,blocker:r.blocker_code,observed:r.observed_value,required:r.required_value,evidence:r.evidence_refs??[],source:r.source,quality:number(r.data_quality) })) } : null,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error ? error.message : "Unable to load candidate",
    };
  }
}
function number(value: unknown) {
  const parsed = Number(value);
  return value === null || !Number.isFinite(parsed) ? null : parsed;
}
