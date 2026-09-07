import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpportunityState } from "@/domain/opportunities";
import type { DataMode } from "./dashboard-data";
import { groupFreshness, numberOrNull, readCurrentRevisions } from "./bounded-latest";

export interface FastFlowItem { id: string; symbol: string; state: OpportunityState; revision: number; walletCount: number | null; relationshipCoverage: number | null; confirmedIndependentCount: number | null; clusterAdjustedCount: number | null; score: number; riskScore: number | null; dataQuality: number; blockers: string[]; evidenceCount: number | null; updatedAt: string }
export interface FastFlowData { mode: DataMode; updatedAt: string | null; provider: string; items: FastFlowItem[]; message: string }

export async function getFastFlowData(): Promise<FastFlowData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable("Fast Flow is not configured");
  try { return await loadFastFlowData(createServiceClient()); }
  catch { return unavailable("Fast Flow data could not be loaded. Try again shortly."); }
}

export async function loadFastFlowData(db: SupabaseClient, now = Date.now()): Promise<FastFlowData> {
  try {
    const cutoff = new Date(now).toISOString();
    const { data, error } = await db.from("opportunities").select("id,current_state,current_revision,opportunity_score,risk_score,data_quality,updated_at,assets(symbol)").eq("opportunity_type", "fast_flow").lte("updated_at", cutoff).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(10);
    if (error) throw error;
    const revisions = await readCurrentRevisions<any>(db, "opportunity_revisions", data ?? [], "opportunity_id,agent_outputs,safety_result,evidence_refs,revision_number,information_cutoff_at", cutoff);
    const latest = new Map<string, any>();
    for (const row of revisions ?? []) if (!latest.has(row.opportunity_id)) latest.set(row.opportunity_id, row);
    let missingRevision = false;
    const items = (data ?? []).map((row: any) => {
      const revision = latest.get(row.id), asset = Array.isArray(row.assets) ? row.assets[0] : row.assets, fast = revision?.agent_outputs?.fastFlow;
      missingRevision ||= !revision;
      const blockers = Array.isArray(revision?.safety_result?.blockers) ? [...revision.safety_result.blockers] : [];
      if (!revision) blockers.push("CURRENT_REVISION_UNAVAILABLE");
      else if ((!Array.isArray(revision.safety_result?.blockers) || typeof revision.safety_result?.policyVersion !== "string") && !blockers.length) blockers.push("SAFETY_STATUS_UNKNOWN");
      return { id: row.id, symbol: asset?.symbol ?? "UNKNOWN", state: row.current_state, revision: Number(row.current_revision), walletCount: Array.isArray(fast?.walletIds) ? fast.walletIds.length : null, relationshipCoverage: numberOrNull(fast?.relationshipCoverage), confirmedIndependentCount: numberOrNull(fast?.confirmedIndependentCount), clusterAdjustedCount: numberOrNull(fast?.clusterAdjustedCount), score: Number(row.opportunity_score), riskScore: numberOrNull(row.risk_score), dataQuality: Number(row.data_quality), blockers, evidenceCount: Array.isArray(revision?.evidence_refs) ? revision.evidence_refs.length : null, updatedAt: row.updated_at };
    });
    const freshness = groupFreshness((data ?? []).map(row => latest.get(row.id)?.information_cutoff_at), now);
    return { mode: missingRevision ? "degraded" : freshness.mode, updatedAt: freshness.updatedAt, provider: "Helius/Solana → Supabase", items, message: missingRevision ? "Current revision evidence is unavailable for one or more opportunities" : items.length ? `${items.length} persisted Fast Flow opportunities; safety shown per revision` : "No persisted verified convergence yet" };
  } catch { return unavailable("Fast Flow data could not be loaded. Try again shortly."); }
}

function unavailable(message: string): FastFlowData { return { mode: "degraded", updatedAt: null, provider: "Helius/Solana → Supabase", items: [], message }; }
