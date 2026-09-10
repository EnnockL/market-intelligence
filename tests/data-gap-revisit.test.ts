import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataGapClosureService } from "@/services/data-gap-closure/service";

vi.mock("@/services/wallet-intelligence/candidate-wallet-evidence", () => ({
  loadCandidateWalletMetrics: vi.fn(async () => ({ rawWalletCount: null, verifiedWalletCount: null,
    confirmedIndependent: null, relationshipCoverage: null, clusterAdjustedCount: null,
    convergenceWindowMs: null, dataQuality: null, evidence: [] })),
}));

const cutoff = "2026-09-06T21:35:34.147Z";
const later = "2026-09-06T21:40:34.147Z";
const available = "2026-09-06T21:35:44.774Z";

function fixture() {
  const candidate = { id: "candidate", asset_id: "asset", current_revision: 1, current_state: "INSUFFICIENT_DATA",
    detected_at: "2026-09-06T21:20:00.000Z", active_window_start: "2026-09-06T21:00:00.000Z",
    assets: { external_id: "mint", crypto_tokens: { mint_address: "mint", first_seen_at: "2026-09-06T21:20:00.000Z" } } };
  const rows: Record<string, any[]> = {
    jackpot_candidates: [candidate],
    jackpot_candidate_revisions: [{ candidate_id: candidate.id, revision_number: 1, information_cutoff_at: candidate.detected_at,
      available_at: candidate.detected_at, features: { riskStatus: "UNKNOWN", dataQuality: 0 } }],
    crypto_liquidity_snapshots: [{ id: "liquidity", asset_id: "asset", liquidity_usd: 35_000, effective_at: cutoff,
      information_available_at: cutoff, provider: "liquidity-provider", data_quality: 90 }],
    token_risk_assessments: [], event_outbox: [],
  };
  let nextAttempt: string | null = null;
  const finalized: any[] = [];
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === "claim_candidate_data_gaps") return { data: nextAttempt && args.input_cutoff < nextAttempt ? [] : [{ candidate_id: candidate.id, claim_token: "claim" }], error: null };
    if (name === "release_candidate_data_gap") { nextAttempt = args.retry_at; return { data: true, error: null }; }
    if (name === "finish_candidate_data_gap") {
      finalized.push(structuredClone(args));
      nextAttempt = args.retry_at;
      candidate.current_revision++;
      rows.jackpot_candidate_revisions.push({ candidate_id: candidate.id, revision_number: candidate.current_revision,
        information_cutoff_at: args.input_cutoff, available_at: args.input_cutoff, features: args.closure.features });
      return { data: [{ created: true, result_revision: candidate.current_revision,
        work_status: args.waiting_after ? "WAITING_EVIDENCE" : "PARTIAL" }], error: null };
    }
    throw new Error(`Unexpected RPC:${name}`);
  });
  const from = vi.fn((table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let maximum = Number.POSITIVE_INFINITY;
    const order: Array<[string, boolean]> = [];
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      lte: (column: string, value: string) => { filters.push((row) => Date.parse(row[column]) <= Date.parse(value)); return query; },
      order: (column: string, options?: { ascending: boolean }) => { order.push([column, options?.ascending ?? true]); return query; },
      limit: (value: number) => { maximum = value; return query; },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      single: async () => ({ data: result()[0] ?? null, error: null }),
    };
    function result() {
      return [...(rows[table] ?? [])].filter((row) => filters.every((predicate) => predicate(row)))
        .sort((left, right) => { for (const [column, ascending] of order) { const compare = String(left[column]).localeCompare(String(right[column])); if (compare) return ascending ? compare : -compare; } return 0; })
        .slice(0, maximum);
    }
    return query;
  });
  const assessment = { tokenId: "mint", provider: "risk-provider", riskVersion: "risk-v1", assessedAt: available,
    informationCutoffAt: available, informationAvailableAt: available, rugStatus: "UNKNOWN", rugRiskScore: null,
    dataQuality: 50, riskComponents: { components: [{ status: "safe" }, { status: "unknown" }] } };
  const risk = { name: "risk-provider", assess: vi.fn(async () => assessment) };
  const liquidity = { name: "liquidity-provider", getHistoricalLiquidity: vi.fn(async () => []) };
  const repo = {
    saveTokenRiskAssessment: vi.fn(async (assetId: string, value: any) => { rows.token_risk_assessments.push({ id: "risk", asset_id: assetId,
      rug_status: value.rugStatus, risk_components: value.riskComponents, data_quality: value.dataQuality, provider: value.provider,
      information_cutoff_at: value.informationCutoffAt, information_available_at: value.informationAvailableAt }); return 1; }),
    saveLiquiditySnapshots: vi.fn(async (points: any[]) => { rows.crypto_liquidity_snapshots.push(...points.map((point) => ({
      id: point.id, asset_id: point.assetId, liquidity_usd: point.liquidityUsd, provider: point.provider,
      effective_at: point.effectiveAt, information_available_at: point.informationAvailableAt, data_quality: point.quality,
    }))); return points.length; }),
  };
  return { service: new DataGapClosureService({ rpc, from } as any, liquidity as any, risk as any, repo as any), rpc, from, risk, liquidity, repo, rows, finalized };
}

describe("data gap evidence revisits", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues a post-cutoff risk fetch and consumes it only in a later immutable revision", async () => {
    const f = fixture();
    const first = await f.service.run(4, cutoff);
    expect(first).toMatchObject({ created: 1, waitingEvidence: 1, failed: 0 });
    const firstWrite = f.finalized[0];
    expect(firstWrite).toMatchObject({ input_cutoff: cutoff, waiting_after: available, expected_revision: 1,
      closure: { features: { riskStatus: "UNKNOWN" } } });
    expect(firstWrite.closure.evidence.some((item: any) => item.type === "token_risk_assessment")).toBe(false);
    expect(await f.service.run(4, cutoff)).toMatchObject({ candidates: 0 });
    expect(await f.service.run(4, later)).toMatchObject({ created: 1, waitingEvidence: 0 });
    expect(f.risk.assess).toHaveBeenCalledOnce();
    expect(f.finalized[1]).toMatchObject({ input_cutoff: later, expected_revision: 2, waiting_after: null,
      closure: { features: { riskStatus: "UNKNOWN" }, gaps: { safety: "PARTIAL", token_risk_coverage: "PARTIAL" } } });
    expect(f.finalized[1].closure.evidence).toContainEqual(expect.objectContaining({ type: "token_risk_assessment", availableAt: available }));
    expect(f.finalized[0]).toEqual(firstWrite);
    expect(f.rows.jackpot_candidate_revisions[0].features).toEqual({ riskStatus: "UNKNOWN", dataQuality: 0 });
  });

  it("also defers liquidity that was not available by the fixed cutoff", async () => {
    const f = fixture();
    f.rows.crypto_liquidity_snapshots = [];
    f.liquidity.getHistoricalLiquidity.mockResolvedValue([{ id: "new-liquidity", assetId: "asset", liquidityUsd: 45_000,
      effectiveAt: cutoff, informationAvailableAt: available, provider: "liquidity-provider", quality: 90 }] as never);
    expect(await f.service.run(4, cutoff)).toMatchObject({ waitingEvidence: 1 });
    expect(f.finalized[0].closure.features.liquidity).toBeNull();
    await f.service.run(4, later);
    expect(f.finalized[1].closure.features.liquidity).toBe(45_000);
    expect(f.liquidity.getHistoricalLiquidity).toHaveBeenCalledOnce();
  });

  it("retains provider failure diagnostics while committing a partial assessment", async () => {
    const f = fixture();
    f.risk.assess.mockRejectedValue(new Error("PROVIDER_UNAVAILABLE"));
    const result = await f.service.run(4, cutoff);
    expect(result.summaries[0]).toMatchObject({ status: "PARTIAL", errors: ["RISK:PROVIDER_UNAVAILABLE"] });
    expect(f.finalized[0].retry_at).toBe(later);
  });

  it("uses a bounded claim and atomically delegates revision conflict handling", async () => {
    const f = fixture();
    const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => name === "finish_candidate_data_gap"
      ? { data: [{ created: false, result_revision: 3, work_status: "REVISION_CHANGED" }], error: null } as any
      : original(name, args));
    expect(await f.service.run(999, cutoff)).toMatchObject({ maximumCandidates: 20, created: 0,
      summaries: [expect.objectContaining({ status: "REVISION_CHANGED" })] });
    expect(f.rpc).toHaveBeenCalledWith("claim_candidate_data_gaps", { batch_limit: 20, input_cutoff: cutoff });
    expect(f.rpc).toHaveBeenCalledWith("finish_candidate_data_gap", expect.objectContaining({ target_claim: "claim", expected_revision: 1 }));
  });

  it("releases a failed read for a later retry instead of silently dropping the claim", async () => {
    const f = fixture();
    f.rows.jackpot_candidate_revisions = [];
    expect(await f.service.run(4, cutoff)).toMatchObject({ failed: 1, created: 0 });
    expect(f.rpc).toHaveBeenCalledWith("release_candidate_data_gap", expect.objectContaining({
      target_candidate: "candidate", target_claim: "claim", retry_at: later, failure_errors: ["NO_SOURCE_REVISION_AVAILABLE_AT_CUTOFF"],
    }));
  });
});
