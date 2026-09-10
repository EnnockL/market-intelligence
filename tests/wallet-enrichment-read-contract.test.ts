import { describe, expect, it, vi } from "vitest";
import { readBoundedPages, ReadBudgetExceeded } from "@/repositories/bounded-read";
import { IngestionRepository } from "@/repositories/ingestion-repository";
import { walletEnrichmentInformation } from "@/domain/wallet-enrichment-information";
import { calculateWalletPnlMetrics, reconstructTradeCycles, type EnrichedWalletTrade } from "@/domain/wallet-pnl";
import { riskCoveragePercent } from "@/domain/risk-coverage";

describe("bounded complete reads", () => {
  it("reads past the REST 1000-row cap without mistaking the first page for all history", async () => {
    const rows = Array.from({ length: 1_205 }, (_, index) => ({ id: index }));
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(await readBoundedPages("wallet", read)).toEqual(rows);
    expect(read).toHaveBeenNthCalledWith(3, 1_000, 1_499);
  });

  it("fails closed if a full history exceeds the budget instead of returning a plausible subset", async () => {
    const rows = Array.from({ length: 1_201 }, (_, index) => index);
    const read = async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null });
    await expect(readBoundedPages("wallet", read, 1_200)).rejects.toBeInstanceOf(ReadBudgetExceeded);
  });

  it("rejects invalid budgets before reading", async () => {
    const read = vi.fn();
    await expect(readBoundedPages("wallet", read, 100, 0)).rejects.toThrow("INVALID_READ_BUDGET");
    await expect(readBoundedPages("wallet", read, -1)).rejects.toThrow("INVALID_READ_BUDGET");
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a complete history exactly at the budget and propagates page errors", async () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => index);
    expect(await readBoundedPages("wallet", async (from, to) => ({ data: rows.slice(from, to + 1), error: null }), 1_000)).toEqual(rows);
    await expect(readBoundedPages("wallet", async () => ({ data: null, error: new Error("QUERY_TIMEOUT") }))).rejects.toThrow("QUERY_TIMEOUT");
  });

  it("requests a bounded server-side pending queue rather than global history/token lists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ transaction_id: "tx-after-row-1000", wallet_id: "new-wallet", mint_address: "new-mint" }], error: null });
    const from = vi.fn();
    const repo = new IngestionRepository({ rpc, from } as any);
    expect(await repo.walletTransactionsForEnrichment("provider", 100_000)).toEqual([expect.objectContaining({ id: "tx-after-row-1000", mintAddress: "new-mint" })]);
    expect(rpc).toHaveBeenCalledWith("claim_wallet_enrichment_targets", expect.objectContaining({ target_provider: "provider", batch_limit: 50 }));
    expect(from).not.toHaveBeenCalled();
  });
});

describe("evidence quality contract", () => {
  const makeTrade = (side: "buy" | "sell", informationCompleteness: number): EnrichedWalletTrade => ({
    id: side, signature: side, instructionIndex: 0, token: "token", side, quantity: 1,
    occurredAt: side === "buy" ? "2026-08-01T10:00:00Z" : "2026-08-01T10:10:00Z",
    tokenPriceUsd: side === "buy" ? 10 : 12, feeUsd: 0.1,
    pricingComplete: true, executionComplete: true, informationCompleteness,
  });

  it("reports the unsupported execution-context capability instead of making pool metadata a verified trade", () => {
    for (const pool of [null, "identified-pool"]) {
      const information = walletEnrichmentInformation(pool);
      expect(information.blockers).toContain("VERIFIED_EXECUTION_CONTEXT_UNAVAILABLE");
      const cycles = reconstructTradeCycles([makeTrade("buy", information.completeness), makeTrade("sell", information.completeness)]);
      expect(cycles[0].dataQuality).toBe(pool ? 90 : 80);
      expect(calculateWalletPnlMetrics(cycles).verifiedTrades).toBe(0);
    }
  });

  it("still accepts fully supported complete trade evidence without changing verification thresholds", () => {
    const cycles = reconstructTradeCycles([makeTrade("buy", 100), makeTrade("sell", 100)]);
    expect(cycles[0]).toMatchObject({ status: "closed", dataQuality: 100 });
    expect(calculateWalletPnlMetrics(cycles).verifiedTrades).toBe(1);
  });

  it("counts lowercase/uppercase unknown risk equally and rejects unrecognised statuses", () => {
    expect(riskCoveragePercent({ components: [{ status: "safe" }, { status: "UNKNOWN" }, { status: "unknown" }, { status: "SAFE" }, { status: "unavailable" }] })).toBe(40);
    expect(riskCoveragePercent({ components: [] })).toBeNull();
    expect(riskCoveragePercent(null)).toBeNull();
  });
});
