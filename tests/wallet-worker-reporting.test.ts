import { FreeCryptoMarketProvider } from "@/services/crypto-market/free-market-provider";
import { describe, expect, it, vi } from "vitest";
import type { IngestionRepository } from "@/repositories/ingestion-repository";
import { runWalletPnl, WalletPnlBatchError } from "@/workers/wallet-pnl";
import { runWalletEvidence, WalletEvidenceBatchError } from "@/workers/wallet-evidence";
import { ProviderError } from "@/services/market-data/provider";
import { unavailableHistorical, type CryptoMarketPoint, type HistoricalPriceRequest } from "@/services/crypto-market/provider";
import type { TokenRiskAssessment } from "@/services/token-risk/provider";

const timestamp = "2026-09-01T10:00:00Z";
const cutoff = "2026-09-01T10:05:00Z";
const wrappedSol = "So11111111111111111111111111111111111111112";

function point(mintAddress: string): CryptoMarketPoint {
  return { ...unavailableHistorical(mintAddress, timestamp, "fixture"), observedAt: cutoff, priceUsd: 10, completeness: "partial" };
}

function pnlFixture() {
  const repo = {
    startRun: vi.fn(async () => "pnl-run"),
    walletTransactionsForEnrichment: vi.fn(async () => [{ id: "tx", mintAddress: "mint", occurred_at: timestamp, quantity: 2, raw_payload: { meta: { fee: 5_000 } } }]),
    saveTransactionEnrichment: vi.fn(async () => ({ status: "partial" })),
    rebuildWalletPnl: vi.fn(async () => ({ cycles: 0, walletsProcessed: 1, blocked: [] as Array<{ walletId: string; reason: string }>, informationBlockers: ["VERIFIED_EXECUTION_CONTEXT_UNAVAILABLE"] })),
    recordProviderError: vi.fn(async (..._args: unknown[]) => {}),
    finishRun: vi.fn(async (..._args: unknown[]) => {}),
    failRun: vi.fn(async (..._args: unknown[]) => {}),
  };
  const provider = { name: "fixture", getCurrent: vi.fn(), getHistorical: vi.fn(async ({ mintAddress }: HistoricalPriceRequest) => point(mintAddress)) };
  return { repo, provider, invoke: () => runWalletPnl(provider, repo as unknown as IngestionRepository) };
}

describe("wallet PnL operational failures never become permanent missing evidence", () => {
  it("validates and persists a composite provider's exact historical source", async () => {
    const f = pnlFixture();
    const composite = new FreeCryptoMarketProvider(f.provider, f.provider, f.provider);
    await expect(runWalletPnl(composite, f.repo as unknown as IngestionRepository)).resolves.toMatchObject({ enriched: 1 });
    expect(f.repo.walletTransactionsForEnrichment).toHaveBeenCalledWith("fixture", 10);
    expect(f.repo.saveTransactionEnrichment).toHaveBeenCalledWith(expect.objectContaining({ provider: "fixture", tokenPoint: expect.objectContaining({ provider: "fixture" }) }));
    expect(f.repo.rebuildWalletPnl).toHaveBeenCalledWith("fixture");
    f.provider.getHistorical.mockResolvedValue({ ...point("mint"), provider: "unexpected" });
    f.repo.saveTransactionEnrichment.mockClear();
    await expect(runWalletPnl(composite, f.repo as unknown as IngestionRepository)).rejects.toBeInstanceOf(WalletPnlBatchError);
    expect(f.repo.saveTransactionEnrichment).not.toHaveBeenCalled();
  });

  it.each([
    ["401 authorization", () => new ProviderError("fixture auth denied", "fixture", "unauthorized", false, 401)],
    ["403 authorization", () => new ProviderError("fixture access denied", "fixture", "unauthorized", false, 403)],
    ["non-retryable schema error", () => new ProviderError("fixture schema failure", "fixture", "invalid_response", false)],
    ["non-retryable HTTP failure", () => new ProviderError("fixture request failure", "fixture", "unavailable", false, 400)],
    ["rate limit", () => new ProviderError("fixture rate limit", "fixture", "rate_limited", true, 429)],
    ["server failure", () => new ProviderError("fixture server failure", "fixture", "unavailable", true, 503)],
    ["transport failure", () => new TypeError("fixture network failure")],
  ] as const)("keeps %s pending and fails the batch", async (_label, makeError) => {
    const f = pnlFixture();
    f.provider.getHistorical.mockRejectedValue(makeError());
    const error = await f.invoke().catch(error => error);
    expect(error).toBeInstanceOf(WalletPnlBatchError);
    expect(error.result).toMatchObject({ considered: 1, enriched: 0, unavailable: 0, recordsProcessed: 0 });
    expect(f.repo.saveTransactionEnrichment).not.toHaveBeenCalled();
    expect(f.repo.rebuildWalletPnl).toHaveBeenCalledWith("fixture");
    expect(f.repo.finishRun).not.toHaveBeenCalled();
    expect(f.repo.failRun).toHaveBeenCalledWith("pnl-run", error, 0);
    expect(f.repo.recordProviderError).toHaveBeenLastCalledWith("pnl-run", "fixture", error, expect.objectContaining({ failedTransactions: 1, recordsProcessed: 0, blockedWallets: 0 }));
  });

  it.each([
    ["null payload", null],
    ["missing schema", { priceUsd: null }],
    ["NaN price", { ...point("mint"), priceUsd: Number.NaN }],
    ["negative price", { ...point("mint"), priceUsd: -1 }],
    ["wrong asset", point("different-mint")],
    ["wrong provider", { ...point("mint"), provider: "different-provider" }],
    ["invalid observation", { ...point("mint"), observedAt: "invalid" }],
    ["price missing without explicit no-data", { ...point("mint"), priceUsd: null }],
  ])("does not persist %s as no-data", async (_label, malformed) => {
    const f = pnlFixture();
    f.provider.getHistorical.mockResolvedValue(malformed as CryptoMarketPoint);
    await expect(f.invoke()).rejects.toBeInstanceOf(WalletPnlBatchError);
    expect(f.repo.saveTransactionEnrichment).not.toHaveBeenCalled();
    expect(f.provider.getHistorical).toHaveBeenCalledOnce();
    expect(f.repo.finishRun).not.toHaveBeenCalled();
  });

  it("can enrich the same pending transaction after credentials recover", async () => {
    const f = pnlFixture();
    f.provider.getHistorical.mockRejectedValueOnce(new ProviderError("denied", "fixture", "unauthorized", false, 401));
    await expect(f.invoke()).rejects.toBeInstanceOf(WalletPnlBatchError);
    expect(f.repo.saveTransactionEnrichment).not.toHaveBeenCalled();
    await expect(f.invoke()).resolves.toMatchObject({ status: "succeeded", enriched: 1, unavailable: 0, recordsProcessed: 1 });
    expect(f.repo.saveTransactionEnrichment).toHaveBeenCalledOnce();
    expect(f.repo.saveTransactionEnrichment).toHaveBeenCalledWith(expect.objectContaining({ transactionId: "tx", rawFeeLamports: 5_000 }));
    expect(f.repo.finishRun).toHaveBeenCalledOnce();
    expect(f.repo.failRun).toHaveBeenCalledOnce();
  });

  it.each(["mint", wrappedSol])("keeps an explicit successful no-data result for %s separate from operational failures", async missingMint => {
    const f = pnlFixture();
    f.provider.getHistorical.mockImplementation(async ({ mintAddress }) => mintAddress === missingMint
      ? { ...unavailableHistorical(mintAddress, timestamp, "fixture", { reason: "HISTORICAL_PRICE_UNAVAILABLE", response: { data: null } }), observedAt: cutoff }
      : point(mintAddress));
    await expect(f.invoke()).resolves.toMatchObject({ status: "succeeded", enriched: 0, unavailable: 1, recordsProcessed: 1, informationBlockers: ["VERIFIED_EXECUTION_CONTEXT_UNAVAILABLE"] });
    expect(f.repo.saveTransactionEnrichment).toHaveBeenCalledOnce();
    expect(f.repo.finishRun).toHaveBeenCalledWith("pnl-run", 1);
    expect(f.repo.failRun).not.toHaveBeenCalled();
    expect(f.repo.recordProviderError).not.toHaveBeenCalled();
  });

  it("does not consume a transaction when the SOL fee-price lookup fails after a valid token lookup", async () => {
    const f = pnlFixture();
    f.provider.getHistorical.mockResolvedValueOnce(point("mint")).mockRejectedValueOnce(new Error("SOL_LOOKUP_FAILED"));
    await expect(f.invoke()).rejects.toBeInstanceOf(WalletPnlBatchError);
    expect(f.repo.saveTransactionEnrichment).not.toHaveBeenCalled();
  });

  it("fails when only the rebuild is blocked, while reporting committed enrichment counts", async () => {
    const f = pnlFixture();
    f.repo.rebuildWalletPnl.mockResolvedValue({ cycles: 2, walletsProcessed: 1, blocked: [{ walletId: "large-wallet", reason: "READ_BUDGET_EXCEEDED" }], informationBlockers: [] });
    const error = await f.invoke().catch(error => error);
    expect(error).toBeInstanceOf(WalletPnlBatchError);
    expect(error.result).toMatchObject({ enriched: 1, recordsProcessed: 1, cycles: 2, errors: [] });
    expect(f.repo.finishRun).not.toHaveBeenCalled();
    expect(f.repo.failRun).toHaveBeenCalledWith("pnl-run", error, 1);
    expect(f.repo.recordProviderError).toHaveBeenCalledWith("pnl-run", "fixture", error, expect.objectContaining({ blockedWallets: 1, failedTransactions: 0, recordsProcessed: 1, cycles: 2 }));
  });

  it("reports failure even if writing the provider error log also fails", async () => {
    const f = pnlFixture();
    f.provider.getHistorical.mockRejectedValue(new Error("PROVIDER_FAILURE"));
    f.repo.recordProviderError.mockRejectedValue(new Error("LOG_FAILURE"));
    await expect(f.invoke()).rejects.toThrow("LOG_FAILURE");
    expect(f.repo.failRun).toHaveBeenCalledOnce();
    expect(f.repo.finishRun).not.toHaveBeenCalled();
  });
});

function evidenceFixture() {
  const assessment: TokenRiskAssessment = { tokenId: "mint", provider: "risk", riskVersion: "fixture", assessedAt: cutoff,
    informationCutoffAt: cutoff, informationAvailableAt: cutoff, rugRiskScore: null, rugStatus: "UNKNOWN", riskComponents: {}, dataQuality: 0 };
  const repo = {
    startRun: vi.fn(async () => "evidence-run"),
    walletEvidenceTargets: vi.fn(async () => [{ assetId: "asset", mintAddress: "mint", from: timestamp, to: timestamp }]),
    hasLiquidityEvidence: vi.fn(async () => false), hasFreshRiskEvidence: vi.fn(async () => false),
    saveLiquiditySnapshots: vi.fn(async (points: unknown[]) => points.length), saveTokenRiskAssessment: vi.fn(async () => 1),
    recordProviderError: vi.fn(async (..._args: unknown[]) => {}), finishRun: vi.fn(async (..._args: unknown[]) => {}), failRun: vi.fn(async (..._args: unknown[]) => {}),
  };
  const liquidity = { name: "liquidity", getHistoricalLiquidity: vi.fn(async () => []) };
  const risk = { name: "risk", assess: vi.fn(async () => assessment) };
  return { repo, liquidity, risk, invoke: () => runWalletEvidence(liquidity, risk, repo as unknown as IngestionRepository, 5, cutoff) };
}

describe("wallet evidence run health", () => {
  it("records a failed run when both providers fail", async () => {
    const f = evidenceFixture();
    f.liquidity.getHistoricalLiquidity.mockRejectedValue(new Error("LIQUIDITY_FAILED"));
    f.risk.assess.mockRejectedValue(new Error("RISK_FAILED"));
    const error = await f.invoke().catch(error => error);
    expect(error).toBeInstanceOf(WalletEvidenceBatchError);
    expect(error.result).toMatchObject({ targets: 1, recordsProcessed: 0 });
    expect(error.result.errors).toHaveLength(2);
    expect(f.repo.finishRun).not.toHaveBeenCalled();
    expect(f.repo.failRun).toHaveBeenCalledWith("evidence-run", error, 0);
    expect(f.repo.recordProviderError).toHaveBeenLastCalledWith("evidence-run", "liquidity+risk", error, { targets: 1, recordsProcessed: 0, failedOperations: 2 });
  });

  it("keeps genuinely unknown risk and empty history distinct from a provider failure", async () => {
    const f = evidenceFixture();
    await expect(f.invoke()).resolves.toMatchObject({ targets: 1, recordsProcessed: 1, errors: [] });
    expect(f.repo.finishRun).toHaveBeenCalledWith("evidence-run", 1);
    expect(f.repo.failRun).not.toHaveBeenCalled();
    expect(f.repo.hasLiquidityEvidence).toHaveBeenCalledWith("asset", timestamp);
    expect(f.liquidity.getHistoricalLiquidity).toHaveBeenCalledWith({ assetId: "asset", mintAddress: "mint", from: "2026-09-01T09:58:00.000Z", to: timestamp, informationCutoffAt: cutoff });
  });

  it("marks the run failed if risk evidence cannot be persisted", async () => {
    const f = evidenceFixture();
    f.repo.saveTokenRiskAssessment.mockRejectedValue(new Error("RISK_SAVE_FAILED"));
    await expect(f.invoke()).rejects.toBeInstanceOf(WalletEvidenceBatchError);
    expect(f.repo.finishRun).not.toHaveBeenCalled();
    expect(f.repo.failRun).toHaveBeenCalledOnce();
  });
});
