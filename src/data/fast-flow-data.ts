import { createServiceClient } from "@/lib/supabase/server";
import type { OpportunityState } from "@/domain/opportunities";
import type { DataMode } from "./dashboard-data";
import { dataModeAt } from "./data-truth";

export interface FastFlowItem { id: string; symbol: string; state: OpportunityState; revision: number; walletCount: number; relationshipCoverage: number | null; confirmedIndependentCount: number | null; clusterAdjustedCount: number | null; score: number; riskScore: number | null; dataQuality: number; blockers: string[]; evidenceCount: number; updatedAt: string }
export interface FastFlowData { mode: DataMode; updatedAt: string | null; provider: string; items: FastFlowItem[]; message: string }

export async function getFastFlowData(): Promise<FastFlowData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable("Fast Flow is not configured");
  try {
    const db = createServiceClient();
    const { data, error } = await db.from("opportunities").select("id,current_state,current_revision,opportunity_score,risk_score,data_quality,updated_at,assets(symbol)").eq("opportunity_type", "fast_flow").order("updated_at", { ascending: false }).limit(10);
    if (error) throw error;
    const ids = (data ?? []).map((row) => row.id);
    const { data: revisions, error: revisionError } = ids.length ? await db.from("opportunity_revisions").select("opportunity_id,agent_outputs,safety_result,evidence_refs,revision_number").in("opportunity_id", ids).order("revision_number", { ascending: false }) : { data: [], error: null };
    if (revisionError) throw revisionError;
    const latest = new Map<string, any>();
    for (const row of revisions ?? []) if (!latest.has(row.opportunity_id)) latest.set(row.opportunity_id, row);
    const items = (data ?? []).map((row: any) => {
      const revision = latest.get(row.id), asset = Array.isArray(row.assets) ? row.assets[0] : row.assets, fast = revision?.agent_outputs?.fastFlow;
      return { id: row.id, symbol: asset?.symbol ?? "UNKNOWN", state: row.current_state, revision: Number(row.current_revision), walletCount: Array.isArray(fast?.walletIds) ? fast.walletIds.length : 0, relationshipCoverage: numberOrNull(fast?.relationshipCoverage), confirmedIndependentCount: numberOrNull(fast?.confirmedIndependentCount), clusterAdjustedCount: numberOrNull(fast?.clusterAdjustedCount), score: Number(row.opportunity_score), riskScore: numberOrNull(row.risk_score), dataQuality: Number(row.data_quality), blockers: Array.isArray(revision?.safety_result?.blockers) ? revision.safety_result.blockers : [], evidenceCount: Array.isArray(revision?.evidence_refs) ? revision.evidence_refs.length : 0, updatedAt: row.updated_at };
    });
    const updatedAt = items.map((item) => item.updatedAt).sort().at(-1) ?? null;
    return { mode: dataModeAt(updatedAt), updatedAt, provider: "Helius/Solana → Supabase", items, message: items.length ? `${items.length} evidence-backed Fast Flow opportunities` : "No persisted verified convergence yet" };
  } catch (error) { return unavailable(`Fast Flow unavailable: ${error instanceof Error ? error.message : "unknown error"}`); }
}

function numberOrNull(value: unknown) { const number = Number(value); return value === null || value === undefined || !Number.isFinite(number) ? null : number; }
function unavailable(message: string): FastFlowData { return { mode: "degraded", updatedAt: null, provider: "Helius/Solana → Supabase", items: [], message }; }
