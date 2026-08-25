import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { HistoricalLiquidityProvider } from "@/services/liquidity/provider";
import type { TokenRiskProvider } from "@/services/token-risk/provider";
export async function runWalletEvidence(liquidity: HistoricalLiquidityProvider, risk: TokenRiskProvider, repository: IngestionRepository, maxTokens = 10) {
  const runId = await repository.startRun("wallet_evidence", `${liquidity.name}+${risk.name}`); let processed = 0;
  try { const targets = await repository.walletEvidenceTargets(maxTokens); const now = new Date().toISOString(); const freshSince = new Date(Date.now() - 3_600_000).toISOString();
    for (const target of targets) { const from = new Date(new Date(target.from).getTime() - 60_000).toISOString(); const to = new Date(new Date(target.to).getTime() + 60_000).toISOString();
      if (!(await repository.hasLiquidityEvidence(target.assetId, liquidity.name, from, to))) { const points = await liquidity.getHistoricalLiquidity({ ...target, from, to, informationCutoffAt: now }); processed += await repository.saveLiquiditySnapshots(points); }
      if (!(await repository.hasFreshRiskEvidence(target.assetId, risk.name, freshSince))) processed += await repository.saveTokenRiskAssessment(target.assetId, await risk.assess(target.mintAddress, now));
    }
    await repository.finishRun(runId, processed); return { runId, targets: targets.length, recordsProcessed: processed };
  } catch (error) { await repository.recordProviderError(runId, `${liquidity.name}+${risk.name}`, error); await repository.failRun(runId, error); throw error; }
}
