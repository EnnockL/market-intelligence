import type { IngestionRepository } from "@/repositories/ingestion-repository";
import type { HistoricalLiquidityProvider } from "@/services/liquidity/provider";
import type { TokenRiskProvider } from "@/services/token-risk/provider";

export async function runWalletEvidence(
  liquidity: HistoricalLiquidityProvider,
  risk: TokenRiskProvider,
  repository: IngestionRepository,
  maxTokens = 10,
  informationCutoffAt = new Date().toISOString(),
) {
  const providerName = `${liquidity.name}+${risk.name}`;
  const runId = await repository.startRun("wallet_evidence", providerName);
  let processed = 0;
  const errors: string[] = [];
  try {
    const targets = await repository.walletEvidenceTargets(maxTokens);
    const freshSince = new Date(
      new Date(informationCutoffAt).getTime() - 3_600_000,
    ).toISOString();
    for (const target of targets) {
      const from = new Date(new Date(target.from).getTime() - 60_000).toISOString();
      const to = new Date(new Date(target.to).getTime() + 60_000).toISOString();
      try {
        if (!(await repository.hasLiquidityEvidence(target.assetId, liquidity.name, from, to))) {
          const points = await liquidity.getHistoricalLiquidity({ ...target, from, to, informationCutoffAt });
          processed += await repository.saveLiquiditySnapshots(points);
        }
      } catch (error) {
        errors.push(`LIQUIDITY:${target.assetId}:${errorText(error)}`);
        await repository.recordProviderError(runId, liquidity.name, error);
      }
      try {
        if (!(await repository.hasFreshRiskEvidence(target.assetId, risk.name, freshSince)))
          processed += await repository.saveTokenRiskAssessment(
            target.assetId,
            await risk.assess(target.mintAddress, informationCutoffAt),
          );
      } catch (error) {
        errors.push(`RISK:${target.assetId}:${errorText(error)}`);
        await repository.recordProviderError(runId, risk.name, error);
      }
    }
    await repository.finishRun(runId, processed);
    return { runId, targets: targets.length, recordsProcessed: processed, errors };
  } catch (error) {
    await repository.recordProviderError(runId, providerName, error);
    await repository.failRun(runId, error);
    throw error;
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
