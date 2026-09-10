import { describe, expect, it, vi } from "vitest";
import { IngestionRepository } from "@/repositories/ingestion-repository";

describe("wallet liquidity queue/read agreement", () => {
  it.each([true, false])("uses the shared database PIT predicate (%s)", async (covered) => {
    const rpc = vi.fn().mockResolvedValue({ data: covered, error: null });
    const from = vi.fn();
    const repo = new IngestionRepository({ rpc, from } as any);
    expect(await repo.hasLiquidityEvidence("asset", "2026-08-01T12:00:00Z")).toBe(covered);
    expect(rpc).toHaveBeenCalledWith("wallet_has_liquidity_evidence_at", {
      target_asset: "asset", target_at: "2026-08-01T12:00:00Z",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([null, [], "true", 1])("does not mistake a malformed coverage response for available data (%j)", async (data) => {
    const repo = new IngestionRepository({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as any);
    await expect(repo.hasLiquidityEvidence("asset", "2026-08-01T12:00:00Z"))
      .rejects.toThrow("WALLET_LIQUIDITY_COVERAGE_INVALID_RESPONSE");
  });

  it("propagates database errors rather than treating an unavailable query as a data gap", async () => {
    const error = new Error("DATABASE_UNAVAILABLE");
    const repo = new IngestionRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error }) } as any);
    await expect(repo.hasLiquidityEvidence("asset", "2026-08-01T12:00:00Z")).rejects.toBe(error);
  });
});
