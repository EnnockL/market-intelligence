import { describe, expect, it, vi } from "vitest";
import { loadLabRunResult } from "@/app/strategy-lab/run-result-data";

const requested = "11111111-1111-4111-8111-111111111111", newest = "22222222-2222-4222-8222-222222222222";
function database(response: unknown, rejects = false) {
  const eq = vi.fn(), limit = vi.fn(), select = vi.fn();
  const chain: any = { select: (...args: unknown[]) => { select(...args); return chain; },
    eq: (...args: unknown[]) => { eq(...args); return chain; }, limit: (...args: unknown[]) => { limit(...args); return chain; },
    maybeSingle: () => rejects ? Promise.reject(response) : Promise.resolve(response) };
  return { db: { from: vi.fn(() => chain) }, eq, limit, select };
}
const run = (id = requested) => ({ id, candle_count: 500, setup_count: 2, trade_count: 0, minimum_sample_size: 30, strategy_evaluation_trades: [] });

describe("selected lab result read is exact and fail-closed", () => {
  it("reads an exact older run outside the first30, with bounded trade payload", async () => {
    const f = database({ data: run(), error: null });
    expect(await loadLabRunResult(f.db as never, requested)).toMatchObject({ status: "ready", run: { id: requested, tradeCount: 0 } });
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("id", requested);
    expect(f.limit).toHaveBeenCalledExactlyOnceWith(1000, { referencedTable: "strategy_evaluation_trades" });
  });
  it.each([{ data: null, error: null }, { data: run(newest), error: null }, { data: null, error: { message: "PRIVATE_READ_ERROR" } }])("never uses global latest for a missing, wrong-ID or failed result", async response => {
    const f = database(response);
    expect(await loadLabRunResult(f.db as never, requested)).toEqual({ status: "unavailable", run: null });
    expect(f.db.from).toHaveBeenCalledOnce();
  });
  it("handles network failure as unavailable without exposing private error details", async () => {
    const f = database(new Error("PRIVATE_URL_AND_TOKEN"), true);
    expect(await loadLabRunResult(f.db as never, requested)).toEqual({ status: "unavailable", run: null });
  });
  it("does not query or choose a result for absent or invalid IDs", async () => {
    const f = database({ data: run() });
    expect(await loadLabRunResult(f.db as never, null)).toEqual({ status: "empty", run: null });
    expect(await loadLabRunResult(f.db as never, "invalid")).toEqual({ status: "unavailable", run: null });
    expect(f.db.from).not.toHaveBeenCalled();
  });
});
