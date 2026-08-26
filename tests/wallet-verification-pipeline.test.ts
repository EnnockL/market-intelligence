import { describe, expect, it, vi } from "vitest";
import { runWalletPnl, selectFairEnrichmentBatch } from "@/workers/wallet-pnl";
import { WALLET_VERIFICATION_POLICY } from "@/domain/wallet-verification";
import { runWalletEvidence } from "@/workers/wallet-evidence";
import { ProviderError } from "@/services/market-data/provider";

describe("wallet verification pipeline", () => {
  it("selects enrichment work fairly across wallets without losing deterministic order", () => {
    const transactions = [
      { id: "a-1", wallet_id: "a", occurred_at: "2026-08-01T00:00:00Z" },
      { id: "a-2", wallet_id: "a", occurred_at: "2026-08-01T00:01:00Z" },
      { id: "a-3", wallet_id: "a", occurred_at: "2026-08-01T00:02:00Z" },
      { id: "b-1", wallet_id: "b", occurred_at: "2026-08-01T00:00:30Z" },
      { id: "c-1", wallet_id: "c", occurred_at: "2026-08-01T00:00:45Z" },
    ];

    expect(selectFairEnrichmentBatch(transactions, 4).map((row) => row.id)).toEqual([
      "a-1",
      "b-1",
      "c-1",
      "a-2",
    ]);
    expect(selectFairEnrichmentBatch([...transactions].reverse(), 4).map((row) => row.id)).toEqual([
      "a-1",
      "b-1",
      "c-1",
      "a-2",
    ]);
  });

  it("keeps the locked verification policy unchanged", () =>
    expect(WALLET_VERIFICATION_POLICY).toEqual({
      version: "wallet-verification-policy-v1",
      minimumVerifiedTradeCycles: 20,
      minimumOverallDataQuality: 80,
      minimumPricingCoverage: 90,
      minimumLiquidityCoverage: 80,
      minimumRiskCoverage: 80,
      minimumHistoryDays: 30,
    }));

  it("bounds provider enrichment work and rebuilds from persisted evidence", async () => {
    const transactions = Array.from({ length: 60 }, (_, index) => ({
      id: `tx-${index}`,
      mintAddress: `mint-${index}`,
      occurred_at: "2026-08-25T00:00:00Z",
      quantity: 1,
      raw_payload: null,
    }));
    const repository = {
      startRun: vi.fn().mockResolvedValue("run-1"),
      walletTransactionsForEnrichment: vi.fn().mockResolvedValue(transactions),
      enrichedTransactionIds: vi.fn().mockResolvedValue(new Set(["tx-0", "tx-1"])),
      saveTransactionEnrichment: vi.fn().mockResolvedValue(undefined),
      recordProviderError: vi.fn().mockResolvedValue(undefined),
      rebuildWalletPnl: vi.fn().mockResolvedValue(0),
      finishRun: vi.fn().mockResolvedValue(undefined),
    } as any;
    const provider = {
      name: "test-market",
      getHistorical: vi.fn().mockResolvedValue(null),
    } as any;
    await expect(runWalletPnl(provider, repository, 500)).resolves.toMatchObject({ status: "succeeded", enriched: 50 });
    expect(repository.walletTransactionsForEnrichment).toHaveBeenCalledWith();
    expect(repository.saveTransactionEnrichment).toHaveBeenCalledTimes(50);
    expect(provider.getHistorical).toHaveBeenCalledTimes(100);
    expect(repository.rebuildWalletPnl).toHaveBeenCalledWith("test-market");
  });

  it("isolates a failed price lookup and continues the persisted rebuild", async () => {
    const repository = {
      startRun: vi.fn().mockResolvedValue("run-3"),
      walletTransactionsForEnrichment: vi.fn().mockResolvedValue([
        { id: "bad", mintAddress: "bad-mint", occurred_at: "2026-08-25T00:00:00Z", quantity: 1, raw_payload: null },
        { id: "good", mintAddress: "good-mint", occurred_at: "2026-08-25T00:01:00Z", quantity: 1, raw_payload: null },
      ]),
      enrichedTransactionIds: vi.fn().mockResolvedValue(new Set()),
      saveTransactionEnrichment: vi.fn().mockResolvedValue(undefined),
      recordProviderError: vi.fn().mockResolvedValue(undefined),
      rebuildWalletPnl: vi.fn().mockResolvedValue(1),
      finishRun: vi.fn().mockResolvedValue(undefined),
    } as any;
    const provider = {
      name: "test-market",
      getHistorical: vi.fn().mockRejectedValueOnce(new Error("NO_PRICE")).mockResolvedValue({ priceUsd: 1 }),
    } as any;
    const result = await runWalletPnl(provider, repository, 10);
    expect(result).toMatchObject({ considered: 2, enriched: 1, cycles: 1 });
    expect(result.errors[0]).toContain("bad:NO_PRICE");
    expect(repository.saveTransactionEnrichment).toHaveBeenCalledOnce();
    expect(repository.finishRun).toHaveBeenCalled();
  });

  it("persists permanent provider failures as UNKNOWN so later work is not starved", async () => {
    const repository = {
      startRun: vi.fn().mockResolvedValue("run-4"),
      walletTransactionsForEnrichment: vi.fn().mockResolvedValue([
        { id: "permanent", mintAddress: "mint", occurred_at: "2026-08-25T00:00:00Z", quantity: 1, raw_payload: null },
      ]),
      enrichedTransactionIds: vi.fn().mockResolvedValue(new Set()),
      saveTransactionEnrichment: vi.fn().mockResolvedValue(undefined),
      recordProviderError: vi.fn().mockResolvedValue(undefined),
      rebuildWalletPnl: vi.fn().mockResolvedValue(0),
      finishRun: vi.fn().mockResolvedValue(undefined),
    } as any;
    const provider = {
      name: "test-market",
      getHistorical: vi.fn().mockRejectedValue(
        new ProviderError("not authorized", "test-market", "unauthorized", false, 401),
      ),
    } as any;

    const result = await runWalletPnl(provider, repository, 10);

    expect(result).toMatchObject({ considered: 1, enriched: 0, unavailable: 1 });
    expect(repository.saveTransactionEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "permanent",
        tokenPoint: expect.objectContaining({ completeness: "unavailable", priceUsd: null }),
        solPoint: expect.objectContaining({ completeness: "unavailable", priceUsd: null }),
      }),
    );
  });

  it("isolates unknown liquidity while still persisting risk evidence", async () => {
    const repository = {
      startRun: vi.fn().mockResolvedValue("run-2"),
      walletEvidenceTargets: vi.fn().mockResolvedValue([
        { assetId: "asset-1", mintAddress: "mint-1", from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" },
      ]),
      hasLiquidityEvidence: vi.fn().mockResolvedValue(false),
      hasFreshRiskEvidence: vi.fn().mockResolvedValue(false),
      saveTokenRiskAssessment: vi.fn().mockResolvedValue(1),
      recordProviderError: vi.fn().mockResolvedValue(undefined),
      finishRun: vi.fn().mockResolvedValue(undefined),
    } as any;
    const liquidity = { name: "limited-liquidity", getHistoricalLiquidity: vi.fn().mockRejectedValue(new Error("NOT_AUTHORIZED")) } as any;
    const risk = { name: "risk-fallback", assess: vi.fn().mockResolvedValue({ classification: "UNKNOWN" }) } as any;
    const result = await runWalletEvidence(liquidity, risk, repository, 5, "2026-08-25T00:00:00Z");
    expect(result.recordsProcessed).toBe(1);
    expect(result.errors[0]).toContain("LIQUIDITY:asset-1:NOT_AUTHORIZED");
    expect(repository.saveTokenRiskAssessment).toHaveBeenCalledOnce();
    expect(repository.finishRun).toHaveBeenCalled();
  });
});
