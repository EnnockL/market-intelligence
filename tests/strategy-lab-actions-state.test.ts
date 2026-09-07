import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), db: vi.fn(), run: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/operator-session", () => ({ requireOperatorPage: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/services/strategy-pattern-lab/service", () => ({ StrategyPatternLabService: class { run = mocks.run; } }));
import { runBacktest } from "@/app/strategy-lab/actions";

const definitionId = "11111111-1111-4111-8111-111111111111", assetId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const values = { definitionId, assetId, startsAt: "2026-01-01", endsAt: "2026-01-31" };
const form = (overrides = {}) => { const result = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key, value]) => result.set(key, value)); return result; };

function database(count = 500) {
  return { from(table: string) {
    const response = table === "strategy_definitions" ? { data: { definition: { strategyId: "ORB" }, timeframe: "5m" }, error: null }
      : table === "assets" ? { data: { id: assetId, symbol: "AMD" }, error: null } : { count, data: null, error: null };
    const chain: any = { select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain, single: async () => response,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve) };
    return chain;
  } };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue(undefined); mocks.db.mockReturnValue(database());
  mocks.run.mockResolvedValue({ runId, reused: false, evaluation: { candleCount: 500, setupCount: 3, tradeCount: 1 } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real network forbidden"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("backtest action returns identity without changing submitted values", () => {
  it.each([false, true])("returns the exact run ID even when reused=%s", async reused => {
    mocks.run.mockResolvedValue({ runId, reused, evaluation: { candleCount: 500, setupCount: 3, tradeCount: 1 } });
    const result = await runBacktest({ status: "IDLE", message: "" }, form());
    expect(result).toMatchObject({ status: "SUCCESS", values, runId, reused });
    expect(mocks.run).toHaveBeenCalledWith({ strategyId: "ORB" }, assetId, "2026-01-31T23:59:59.999Z", "2026-01-01T00:00:00.000Z");
    expect(mocks.revalidate).toHaveBeenCalledWith("/strategy-lab"); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns a saved zero-trade result as a warning, not as a profitable success", async () => {
    mocks.run.mockResolvedValue({ runId, reused: true, evaluation: { candleCount: 500, setupCount: 3, tradeCount: 0 } });
    const result = await runBacktest({ status: "IDLE", message: "" }, form());
    expect(result).toMatchObject({ status: "WARNING", values, runId, reused: true });
    expect(result.message).toContain("0 trades"); expect(result.message).toContain("inget lönsamhetsresultat");
  });
  it("keeps dates and selections when no candles are available and returns no result ID", async () => {
    mocks.db.mockReturnValue(database(0));
    const result = await runBacktest({ status: "IDLE", message: "" }, form());
    expect(result).toMatchObject({ status: "ERROR", values }); expect(result.runId).toBeUndefined();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("keeps invalid dates for correction and does not run a fallback window", async () => {
    const invalid = { startsAt: "2026-02-01", endsAt: "2026-01-01" };
    expect(await runBacktest({ status: "IDLE", message: "" }, form(invalid))).toMatchObject({ status: "ERROR", values: { ...values, ...invalid } });
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("never retains a previous success ID when a new run fails", async () => {
    mocks.run.mockRejectedValue(new Error("PRIVATE_PROVIDER_ERROR"));
    const result = await runBacktest({ status: "SUCCESS", message: "previous", runId }, form());
    expect(result).toMatchObject({ status: "ERROR", values }); expect(result.runId).toBeUndefined();
    expect(result.message).not.toContain("PRIVATE");
  });
  it("preserves authorization before any form read or database effect", async () => {
    mocks.guard.mockRejectedValue(new Error("OPERATOR_REQUIRED")); const submitted = form(), read = vi.spyOn(submitted, "get");
    await expect(runBacktest({ status: "IDLE", message: "" }, submitted)).rejects.toThrow("OPERATOR_REQUIRED");
    expect(read).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
});
