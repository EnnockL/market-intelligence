import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadQualificationData } from "@/data/qualification-data";

function database(responses: Record<string, unknown>) {
  const selections: string[] = [];
  return { selections, db: { from: vi.fn((table: string) => {
    const query: any = { then: (resolve: any, reject: any) => Promise.resolve(responses[table]).then(resolve, reject) };
    query.select = (columns: string) => { selections.push(`${table}:${columns}`); return query; };
    for (const method of ["order", "limit", "maybeSingle", "in"]) query[method] = () => query;
    return query;
  }) } as unknown as SupabaseClient };
}
const snapshot = { policy_version: "test-v1", funnel: { DISCOVERED: 950, QUALIFIED: 0 },
  blocker_frequency: { QUALITY: 40 }, unknown_frequency: {}, information_cutoff_at: "2026-09-06T21:00:00Z" };
const evaluation = { id: "e1", candidate_id: "c1", candidate_revision: 2, current_state: "WATCHING", final_decision: "WATCH",
  decision_reason: "DATA_BLOCKED", requirements_failed: 0, requirements_unknown: 2, information_cutoff_at: "2026-09-06T21:00:00Z", policy_version: "test-v1" };

describe("qualification partial read failure", () => {
  it("keeps the successful summary when evaluations time out", async () => {
    const { db, selections } = database({ qualification_aggregate_snapshots: { data: snapshot },
      qualification_evaluations: { data: null, error: { code: "57014" } } });
    const result = await loadQualificationData(db);
    expect(result).toMatchObject({ summaryStatus: "ready", candidatesStatus: "error", mode: "degraded", funnel: { DISCOVERED: 950, QUALIFIED: 0 } });
    expect(selections.every(columns => !columns.includes("qualification_requirements("))).toBe(true);
  });
  it("keeps evaluations when the summary fails without inventing a zero funnel", async () => {
    const { db } = database({ qualification_aggregate_snapshots: { data: null, error: { code: "57014" } },
      qualification_evaluations: { data: [evaluation] }, jackpot_candidates: { data: [{ id: "c1", asset_id: "a1" }] }, assets: { data: [{ id: "a1", symbol: "TEST" }] } });
    const result = await loadQualificationData(db);
    expect(result.funnel).toBeNull();
    expect(result.candidates[0]).toMatchObject({ symbol: "TEST", failed: 0, unknown: 2 });
    expect(result.summaryStatus).toBe("error");
  });
  it("represents empty successful reads as empty", async () => {
    const { db } = database({ qualification_aggregate_snapshots: { data: null }, qualification_evaluations: { data: [] } });
    expect(await loadQualificationData(db)).toMatchObject({ summaryStatus: "empty", candidatesStatus: "empty", funnel: null, mode: "unavailable" });
  });
});
