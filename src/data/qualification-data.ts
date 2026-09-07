import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { dataModeAt, latestTimestamp, type DataMode } from "./data-truth";
import { readQuery, type ReadStatus } from "./query-result";

type Counts = Record<string, number>;
interface Snapshot { policy_version: string; funnel: Counts; blocker_frequency: Counts; unknown_frequency: Counts; information_cutoff_at: string }
interface Evaluation {
  id: string; candidate_id: string; candidate_revision: number; current_state: string; final_decision: string;
  decision_reason: string; requirements_failed: number; requirements_unknown: number; information_cutoff_at: string; policy_version: string;
}
export interface QualificationData {
  mode: DataMode; summaryStatus: ReadStatus; candidatesStatus: ReadStatus; symbolsUnavailable: boolean; policyVersion: string;
  funnel: Counts | null; blockerFrequency: Counts | null; unknownFrequency: Counts | null; cutoff: string | null;
  candidates: Array<{ id: string; evaluationId: string; revision: number; symbol: string; state: string; decision: string;
    reason: string; failed: number; unknown: number; cutoff: string }>;
}
function unavailable(): QualificationData {
  return { mode: "degraded", summaryStatus: "error", candidatesStatus: "error", symbolsUnavailable: false,
    policyVersion: "UNKNOWN", funnel: null, blockerFrequency: null, unknownFrequency: null, cutoff: null, candidates: [] };
}
export async function getQualificationData(): Promise<QualificationData> {
  try { return await loadQualificationData(createServiceClient()); }
  catch { return unavailable(); }
}
export async function loadQualificationData(db: SupabaseClient): Promise<QualificationData> {
  // Limit evaluations BEFORE resolving names. The old nested requirements join
  // could timeout and discard an otherwise healthy summary.
  const [summary, evaluations] = await Promise.all([
    readQuery<Snapshot>(db.from("qualification_aggregate_snapshots")
      .select("policy_version,funnel,blocker_frequency,unknown_frequency,information_cutoff_at")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()),
    readQuery<Evaluation[]>(db.from("qualification_evaluations")
      .select("id,candidate_id,candidate_revision,current_state,final_decision,decision_reason,requirements_failed,requirements_unknown,information_cutoff_at,policy_version")
      .order("information_cutoff_at", { ascending: false }).order("id", { ascending: false }).limit(12)),
  ]);
  const rows = evaluations.data ?? [];
  const symbols = new Map<string, string>();
  let symbolsUnavailable = false;
  if (rows.length) {
    const candidates = await readQuery<Array<{ id: string; asset_id: string }>>(db.from("jackpot_candidates")
      .select("id,asset_id").in("id", [...new Set(rows.map(row => row.candidate_id))]));
    symbolsUnavailable = candidates.status === "error";
    if (candidates.data?.length) {
      const assets = await readQuery<Array<{ id: string; symbol: string }>>(db.from("assets")
        .select("id,symbol").in("id", [...new Set(candidates.data.map(row => row.asset_id))]));
      symbolsUnavailable ||= assets.status === "error";
      const byAsset = new Map((assets.data ?? []).map(row => [row.id, row.symbol]));
      for (const candidate of candidates.data) {
        const symbol = byAsset.get(candidate.asset_id);
        if (symbol) symbols.set(candidate.id, symbol);
      }
    }
  }
  const snapshot = summary.data;
  const cutoff = snapshot?.information_cutoff_at ?? null;
  const anyError = summary.status === "error" || evaluations.status === "error" || symbolsUnavailable;
  return { mode: anyError ? "degraded" : dataModeAt(latestTimestamp([cutoff, rows[0]?.information_cutoff_at])),
    summaryStatus: summary.status, candidatesStatus: evaluations.status, symbolsUnavailable,
    policyVersion: snapshot?.policy_version ?? rows[0]?.policy_version ?? "UNKNOWN",
    funnel: snapshot?.funnel ?? null, blockerFrequency: snapshot?.blocker_frequency ?? null, unknownFrequency: snapshot?.unknown_frequency ?? null, cutoff,
    candidates: rows.map(row => ({ id: row.candidate_id, evaluationId: row.id, revision: row.candidate_revision,
      symbol: symbols.get(row.candidate_id) ?? "UNKNOWN", state: row.current_state, decision: row.final_decision,
      reason: row.decision_reason, failed: row.requirements_failed, unknown: row.requirements_unknown, cutoff: row.information_cutoff_at })),
  };
}
