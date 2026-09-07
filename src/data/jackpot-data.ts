import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { DataMode } from "./data-truth";
import { groupFreshness, numberOrNull, readCurrentRevisions } from "./bounded-latest";

export interface JackpotItem {
  id: string; symbol: string; state: string; detectedAt: string;
  raw: number | null; independent: number | null; coverage: number | null;
  liquidity: number | null; marketCap: number | null; safety: string;
}
export interface JackpotData { mode: DataMode; items: JackpotItem[]; updatedAt: string | null; error: string | null }

export async function getJackpotData(): Promise<JackpotData> {
  try { return await loadJackpotData(createServiceClient()); }
  catch { return unavailable(); }
}

export async function loadJackpotData(db: SupabaseClient, now = Date.now()): Promise<JackpotData> {
  try {
    const cutoff = new Date(now).toISOString();
    const { data, error } = await db.from("jackpot_candidates")
      .select("id,current_state,detected_at,current_revision,assets(symbol)")
      .lte("detected_at", cutoff).order("detected_at", { ascending: false }).order("id", { ascending: false }).limit(10);
    if (error) throw error;
    const revisions = await readCurrentRevisions<any>(db, "jackpot_candidate_revisions", data ?? [],
      "candidate_id,revision_number,features,safety_result,information_cutoff_at", cutoff);
    const byCandidate = new Map(revisions.map(revision => [revision.candidate_id, revision]));
    const items = (data ?? []).map((row: any): JackpotItem => {
      const revision = byCandidate.get(row.id), features = revision?.features ?? {};
      return { id: row.id, symbol: (Array.isArray(row.assets) ? row.assets[0] : row.assets)?.symbol ?? "UNKNOWN",
        state: row.current_state, detectedAt: row.detected_at,
        raw: numberOrNull(features.rawWalletCount), independent: numberOrNull(features.confirmedIndependent),
        coverage: numberOrNull(features.relationshipCoverage), liquidity: numberOrNull(features.liquidity), marketCap: numberOrNull(features.marketCap),
        safety: typeof revision?.safety_result?.status === "string" ? revision.safety_result.status : "UNKNOWN" };
    });
    const freshness = groupFreshness((data ?? []).map(row => byCandidate.get(row.id)?.information_cutoff_at), now);
    return { ...freshness, items, error: (data ?? []).some(row => !byCandidate.has(row.id)) ? "Current revision evidence is unavailable for one or more candidates." : null };
  } catch { return unavailable(); }
}

function unavailable(): JackpotData {
  return { mode: "degraded", updatedAt: null, items: [], error: "Jackpot data could not be loaded. Try again shortly." };
}
