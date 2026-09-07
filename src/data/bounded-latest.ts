import type { SupabaseClient } from "@supabase/supabase-js";
import { dataModeAt, type DataMode } from "./data-truth";

/** Current revision identity is part of the parent snapshot. Never join all
 * history, or choose whichever revision happens to be returned last. */
export async function readCurrentRevisions<T>(
  db: SupabaseClient,
  table: "opportunity_revisions" | "jackpot_candidate_revisions",
  parents: Array<{ id: string; current_revision: number }>,
  fields: string,
  cutoff: string,
): Promise<T[]> {
  if (parents.length > 10) throw new Error("REVISION_READ_BUDGET_EXCEEDED");
  const column = table === "opportunity_revisions" ? "opportunity_id" : "candidate_id";
  const references = parents.filter(parent => parent.current_revision > 0);
  if (!references.length) return [];
  if (references.some(parent => !/^[a-f0-9-]{36}$/i.test(parent.id) || !Number.isSafeInteger(parent.current_revision))) {
    throw new Error("INVALID_REVISION_REFERENCE");
  }
  // Each pair has a UNIQUE constraint. The limit therefore cannot let a busy
  // candidate consume a quieter candidate's slot. At most ten rows are read.
  const { data, error } = await db.from(table).select(fields)
    .or(references.map(parent => `and(${column}.eq.${parent.id},revision_number.eq.${parent.current_revision})`).join(","))
    .lte("created_at", cutoff).limit(references.length);
  if (error) throw error;
  return (data ?? []) as T[];
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A fresh asset must not make another stale/missing displayed asset look live. */
export function groupFreshness(timestamps: Array<string | null | undefined>, now: number): { mode: DataMode; updatedAt: string | null } {
  if (!timestamps.length) return { mode: "unavailable", updatedAt: null };
  const modes = timestamps.map(value => dataModeAt(value, now));
  const valid = timestamps.filter((value): value is string => dataModeAt(value, now) !== "unavailable");
  const updatedAt = valid.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return { mode: modes.includes("unavailable") ? "degraded" : modes.includes("stale") ? "stale" : "live", updatedAt };
}
