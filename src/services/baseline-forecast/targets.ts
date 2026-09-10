import type { SupabaseClient } from "@supabase/supabase-js";
import { BASELINE_INPUT_POLICY } from "./observations";

export const BASELINE_TARGET_POLICY = {
  version: "recent-with-reserved-backfill-v1",
  recentWindowMs: 60 * 60_000,
  reservedBackfill: 5,
} as const;

export async function loadBaselineTargets(db: SupabaseClient, now: string) {
  const boundary = new Date(Date.parse(now) - BASELINE_TARGET_POLICY.recentWindowMs).toISOString();
  const query = () => db.from("baseline_forecast_pending_targets_v2").select("*")
    .lte("information_cutoff_at", now).lte("available_at", now);
  const [recent, historical] = await Promise.all([
    query().gte("information_cutoff_at", boundary).order("information_cutoff_at", { ascending: false })
      .order("id").limit(BASELINE_INPUT_POLICY.maxTargets),
    query().lt("information_cutoff_at", boundary).order("information_cutoff_at")
      .order("id").limit(BASELINE_INPUT_POLICY.maxTargets),
  ]);
  if (recent.error) throw recent.error;
  if (historical.error) throw historical.error;
  const current = recent.data ?? [], backfill = historical.data ?? [];
  const currentCount = Math.min(current.length, BASELINE_INPUT_POLICY.maxTargets - Math.min(backfill.length, BASELINE_TARGET_POLICY.reservedBackfill));
  return [...current.slice(0, currentCount), ...backfill.slice(0, BASELINE_INPUT_POLICY.maxTargets - currentCount)];
}
