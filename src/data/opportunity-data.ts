import { createServiceClient } from "@/lib/supabase/server";
import type { DataMode } from "./dashboard-data";
import type { OpportunityState } from "@/domain/opportunities";

export interface DashboardFastOpportunity { id: string; symbol: string; name: string; state: OpportunityState; score: number; riskScore: number | null; dataQuality: number; walletCount: number; blockers: string[]; detectedAt: string; updatedAt: string; }
export interface DashboardOpportunityData { mode: DataMode; updatedAt: string | null; items: DashboardFastOpportunity[]; message: string; }
type AssetLabel = { symbol: string; name: string };
type OpportunityRow = { id: string; state: OpportunityState; opportunity_score: number; risk_score: number | null; data_quality: number; detected_at: string; updated_at: string; assets: AssetLabel | AssetLabel[] | null };
type RevisionRow = { opportunity_id: string; wallet_ids: string[] | null; blockers: unknown };

export async function getFastFlowData(): Promise<DashboardOpportunityData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable("Fast Flow is not configured");
  try {
    const db = createServiceClient();
    const { data, error } = await db.from("opportunities").select("id,state,opportunity_score,risk_score,data_quality,detected_at,updated_at,assets(symbol,name)").eq("opportunity_type", "fast_flow").order("detected_at", { ascending: false }).limit(12);
    if (error) throw error;
    const rows = (data ?? []) as OpportunityRow[];
    const response = rows.length ? await db.from("opportunity_revisions").select("opportunity_id,wallet_ids,blockers").in("opportunity_id", rows.map((row) => row.id)).order("revision", { ascending: false }) : { data: [] as RevisionRow[], error: null };
    if (response.error) throw response.error;
    const latest = new Map<string, RevisionRow>();
    for (const revision of (response.data ?? []) as RevisionRow[]) if (!latest.has(revision.opportunity_id)) latest.set(revision.opportunity_id, revision);
    const items = rows.map((row) => { const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets; const revision = latest.get(row.id); return { id: row.id, symbol: asset?.symbol ?? "UNKNOWN", name: asset?.name ?? "Unknown asset", state: row.state, score: Number(row.opportunity_score), riskScore: row.risk_score === null ? null : Number(row.risk_score), dataQuality: Number(row.data_quality), walletCount: revision?.wallet_ids?.length ?? 0, blockers: stringArray(revision?.blockers), detectedAt: row.detected_at, updatedAt: row.updated_at }; });
    const updatedAt = items.map((item) => item.updatedAt).sort().at(-1) ?? null;
    const stale = updatedAt ? Date.now() - new Date(updatedAt).getTime() > 15 * 60_000 : false;
    return { mode: stale ? "stale" : "live", updatedAt, items, message: items.length ? `${items.length} traceable Fast Flow opportunities` : "Fast Flow is live; no verified convergence yet" };
  } catch (error) { return unavailable(`Fast Flow unavailable: ${error instanceof Error ? error.message : "unknown error"}`); }
}
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function unavailable(message: string): DashboardOpportunityData { return { mode: "degraded", updatedAt: null, items: [], message }; }
