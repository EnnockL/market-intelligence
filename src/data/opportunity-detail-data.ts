import { createServiceClient } from "@/lib/supabase/server";
import type { OpportunityState, RevisionType } from "@/domain/opportunities";

export interface OpportunityTimelineItem { revision: number; revisionType: RevisionType; state: OpportunityState; createdAt: string; informationCutoffAt: string; triggerEventId: string; evidenceCount: number; }
export interface OpportunityDetailData { id: string; assetId: string; opportunityType: string; state: OpportunityState; currentRevision: number; sourceEventId: string; detectedAt: string; timeline: OpportunityTimelineItem[]; }

export async function getOpportunityDetail(id: string): Promise<{ data: OpportunityDetailData | null; error: string | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { data: null, error: "Supabase service access is not configured" };
  try {
    const db = createServiceClient();
    const { data: opportunity, error } = await db.from("opportunities").select("id,asset_id,opportunity_type,current_state,current_revision,created_from_event_id,detected_at").eq("id", id).maybeSingle();
    if (error) throw error; if (!opportunity) return { data: null, error: null };
    const { data: revisions, error: revisionError } = await db.from("opportunity_revisions").select("id,revision_number,revision_type,state,created_at,information_cutoff_at,trigger_event_id").eq("opportunity_id", id).order("revision_number", { ascending: true });
    if (revisionError) throw revisionError;
    const revisionIds = (revisions ?? []).map((item) => item.id as string);
    const { data: links, error: linkError } = revisionIds.length ? await db.from("opportunity_revision_evidence").select("opportunity_revision_id").in("opportunity_revision_id", revisionIds) : { data: [], error: null };
    if (linkError) throw linkError;
    const counts = new Map<string, number>(); for (const link of links ?? []) counts.set(link.opportunity_revision_id, (counts.get(link.opportunity_revision_id) ?? 0) + 1);
    return { data: { id: opportunity.id, assetId: opportunity.asset_id, opportunityType: opportunity.opportunity_type, state: opportunity.current_state,
      currentRevision: Number(opportunity.current_revision), sourceEventId: opportunity.created_from_event_id, detectedAt: opportunity.detected_at,
      timeline: (revisions ?? []).map((item) => ({ revision: Number(item.revision_number), revisionType: item.revision_type, state: item.state,
        createdAt: item.created_at, informationCutoffAt: item.information_cutoff_at, triggerEventId: item.trigger_event_id, evidenceCount: counts.get(item.id) ?? 0 })) }, error: null };
  } catch (error) { return { data: null, error: error instanceof Error ? error.message : "Unknown opportunity diagnostic error" }; }
}
