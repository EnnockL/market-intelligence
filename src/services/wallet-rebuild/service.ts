import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateWalletPnlMetrics, reconstructTradeCycles, POSITION_ENGINE_VERSION, type EnrichedWalletTrade, type TradeCycle } from "@/domain/wallet-pnl";
import { calculateWalletScoreV2, calculateWalletScoreV3 } from "@/domain/wallet-scoring";
import { calculateRugExposure, type PointInTimeRisk, type TokenRiskClassification } from "@/domain/token-risk";
import { classifyExecutionCapacity } from "@/domain/historical-liquidity";
import { buildRealizedPnlCurve, calculateDrawdown, PERFORMANCE_CURVE_VERSION } from "@/domain/wallet-performance";
import { buildVerificationProgress, calculateDataQualityV3, evaluateWalletVerification, WALLET_VERIFICATION_POLICY } from "@/domain/wallet-verification";
import { chunks, readBoundedPages } from "@/repositories/bounded-read";

export type RebuildCycle = TradeCycle & { id: string; assetId: string; liquidityQuality: number; capacityRisk: string; entryRisk: PointInTimeRisk | null; latestRisk: TokenRiskClassification | null };

export class WalletRebuildService {
  constructor(private readonly db: SupabaseClient) {}

  async run(walletId: string, provider: string) {
    const started = await this.db.rpc("start_wallet_rebuild", { p_wallet: walletId, p_provider: provider, p_engine: POSITION_ENGINE_VERSION });
    if (started.error) throw started.error;
    const job = Array.isArray(started.data) ? started.data[0] : started.data;
    const claimed = await this.db.rpc("claim_wallet_rebuild_parts", { p_job: job.id, p_limit: 100 });
    if (claimed.error) throw claimed.error;
    const parts = (claimed.data ?? []).map((part: any) => ({ ...part,
      cycles: reconstructTradeCycles(part.transactions.map((event: EnrichedWalletTrade) => ({ ...event,
        quantity: Number(event.quantity), occurredAt: new Date(event.occurredAt).toISOString(),
        tokenPriceUsd: event.tokenPriceUsd === null ? null : Number(event.tokenPriceUsd),
        feeUsd: event.feeUsd === null ? null : Number(event.feeUsd),
      }))).map(cycle => ({ ...cycle, id: randomUUID(), assetId: part.asset_id })),
    }));
    const context = new Map<string, any>();
    for (const batch of chunks<any>(parts.flatMap((part: any) => part.cycles), 250)) {
      const result = await this.db.rpc("wallet_rebuild_context", { p_job: job.id, p_cycles: batch.map(cycle => ({
        id: cycle.id, assetId: cycle.assetId, firstEntryAt: cycle.firstEntryAt, finalExitAt: cycle.finalExitAt,
      })) });
      if (result.error) throw result.error;
      for (const row of result.data ?? []) context.set(row.id, row);
      if (batch.some(cycle => !context.has(cycle.id))) throw new Error("WALLET_CONTEXT_INCOMPLETE");
    }
    if (parts.length) {
      const saved = await this.db.rpc("save_wallet_rebuild_parts", { p_job: job.id, p_parts: parts.map((part: any) => ({
        assetId: part.asset_id, leaseToken: part.lease_token,
        payload: buildWalletAssetPayload(walletId, part.cycles, context),
      })) });
      if (saved.error) throw saved.error;
    }
    const remaining = await this.db.from("wallet_rebuild_parts").select("asset_id", { count: "exact", head: true }).eq("job_id", job.id).neq("status", "DONE");
    if (remaining.error) throw remaining.error;
    if (remaining.count === null) throw new Error("WALLET_REBUILD_COUNT_UNAVAILABLE");
    const progress = { jobId: job.id, cutoffAt: job.cutoff_at, completedAssets: Number(job.expected_assets) - remaining.count, totalAssets: Number(job.expected_assets) };
    if (remaining.count > 0) return { ...progress, completed: false, cycles: 0 };
    const complete = await readBoundedPages<any>(`wallet-rebuild-parts:${job.id}`, (from, to) => this.db.from("wallet_rebuild_parts")
      .select("asset_id,payload").eq("job_id", job.id).eq("status", "DONE").order("asset_id").range(from, to), Number(job.expected_assets));
    if (complete.length !== Number(job.expected_assets)) throw new Error("WALLET_REBUILD_PARTS_MISSING");
    const cycles: RebuildCycle[] = complete.flatMap(part => part.payload.cycles);
    const published = await this.db.rpc("publish_wallet_rebuild", { p_job: job.id,
      p_summary: buildWalletRebuildSummary(walletId, new Date(job.cutoff_at).toISOString(), cycles),
    });
    if (published.error) throw published.error;
    return { ...progress, completed: true, cycles: Number(published.data) };
  }
}

export function buildWalletAssetPayload(walletId: string, cycles: Array<TradeCycle & { id: string; assetId: string }>, context: Map<string, any>) {
  const enriched: RebuildCycle[] = cycles.map(cycle => {
    const c = context.get(cycle.id);
    if (!c) throw new Error("WALLET_CONTEXT_INCOMPLETE");
    const capacity = classifyExecutionCapacity(cycle.investedUsd, c.entry ? Number(c.entry.liquidity_usd) : null);
    return { ...cycle, liquidityQuality: c.entry?.data_quality ?? 0, capacityRisk: capacity.risk,
      latestRisk: c.latestRisk ?? null,
      entryRisk: c.risk ? { assetId: cycle.assetId, status: c.risk.rug_status, score: c.risk.rug_risk_score,
        informationCutoffAt: c.risk.information_cutoff_at, informationAvailableAt: c.risk.information_available_at,
        dataQuality: c.risk.data_quality } : null,
    };
  });
  const rows = enriched.map(cycle => {
    const c = context.get(cycle.id);
    const capacity = classifyExecutionCapacity(cycle.investedUsd, c.entry ? Number(c.entry.liquidity_usd) : null);
    return { id: cycle.id, wallet_id: walletId, asset_id: cycle.assetId, cycle_number: cycle.cycleNumber,
      engine_version: cycle.engineVersion, status: cycle.status, quantity: cycle.quantity, invested_usd: cycle.investedUsd,
      cost_basis_usd: cycle.costBasisUsd, average_entry_usd: cycle.averageEntryUsd, proceeds_usd: cycle.proceedsUsd,
      realized_pnl_usd: cycle.realizedPnlUsd, unrealized_pnl_usd: cycle.unrealizedPnlUsd, return_percent: cycle.returnPercent,
      first_entry_at: cycle.firstEntryAt, final_exit_at: cycle.finalExitAt, holding_seconds: cycle.holdingSeconds,
      pricing_completeness: cycle.pricingCompleteness, transaction_completeness: cycle.transactionCompleteness,
      execution_completeness: cycle.executionCompleteness, information_completeness: cycle.informationCompleteness,
      entry_liquidity_usd: c.entry?.liquidity_usd ?? null, exit_liquidity_usd: c.exit?.liquidity_usd ?? null,
      min_liquidity_during_trade_usd: c.minimumLiquidity, max_liquidity_during_trade_usd: c.maximumLiquidity,
      liquidity_source: c.entry?.provider ?? null, liquidity_observed_at: c.entry?.effective_at ?? null,
      liquidity_data_quality: cycle.liquidityQuality, position_to_liquidity_ratio: capacity.ratio,
      execution_capacity_risk: capacity.risk, data_quality: cycle.dataQuality, transaction_ids: cycle.transactionIds,
    };
  });
  return { rows, cycles: enriched };
}

export function buildWalletRebuildSummary(walletId: string, now: string, cycles: RebuildCycle[], publishedAt = new Date().toISOString()) {
  const summary: Record<string, any[]> = { wallet_performance_points: [] };
  const put = (table: string, value: any) => { (summary[table] ??= []).push(...(Array.isArray(value) ? value : [value])); };
  const metrics = calculateWalletPnlMetrics(cycles); const quality = cycles.length ? Math.round(cycles.reduce((sum, cycle) => sum + cycle.dataQuality, 0) / cycles.length) : 0;
  const risk = calculateRugExposure(cycles.filter(item => item.finalExitAt).map(item => ({ assetId: item.assetId, classification: item.latestRisk })));
  const entryRisks = cycles.filter(item => item.finalExitAt).map(item => item.entryRisk);
  const riskCoverage = entryRisks.length ? Math.round(entryRisks.filter(Boolean).length / entryRisks.length * 100) : 0;
  const rugRate = entryRisks.filter(Boolean).length ? entryRisks.filter((item) => item?.status === "HIGH_RISK" || item?.status === "CONFIRMED_RUG").length / entryRisks.filter(Boolean).length : null;
  const pricingCoverage = cycles.length ? Math.round(cycles.reduce((sum, item) => sum + item.pricingCompleteness, 0) / cycles.length) : 0;
  const liquidityCoverage = cycles.length ? Math.round(cycles.filter((item) => item.liquidityQuality > 0).length / cycles.length * 100) : 0;
  const curve = buildRealizedPnlCurve(cycles); const drawdown = calculateDrawdown(curve);
  if (curve.length) { put("wallet_performance_points", curve.map((point) => ({ wallet_id: walletId, trade_cycle_id: point.tradeCycleId, curve_version: PERFORMANCE_CURVE_VERSION, point_at: point.timestamp, cumulative_realized_pnl_usd: point.cumulativeRealizedPnlUsd, cumulative_return: point.cumulativeReturn, equity_index: point.equityIndex, information_available_at: publishedAt }))); }
  const historyDays = cycles.length ? Math.max(0, (new Date(now).getTime() - new Date(cycles.map((item) => item.firstEntryAt).sort()[0]).getTime()) / 86_400_000) : 0;
  const dataQualityV3 = calculateDataQualityV3({ transaction: quality, pricing: pricingCoverage, liquidity: liquidityCoverage, fees: cycles.length ? Math.round(cycles.reduce((sum, item) => sum + item.executionCompleteness, 0) / cycles.length) : 0, priorityFees: 0, risk: riskCoverage, drawdownAvailable: drawdown.status === "available", tradeCycles: quality });
  const verificationInput = { verifiedTradeCycles: metrics.verifiedTrades, overallDataQuality: dataQualityV3, pricingCoverage, liquidityCoverage, riskCoverage, historyDays: Math.floor(historyDays), drawdownAvailable: drawdown.status === "available" };
  const verification = evaluateWalletVerification(verificationInput); const progress = buildVerificationProgress(verificationInput);
  put("wallet_metric_snapshots", { wallet_id: walletId, engine_version: POSITION_ENGINE_VERSION,
    scoring_version: "wallet-metrics-v2-preparation", calculated_at: publishedAt, information_available_through: now, closed_trades: metrics.closedTrades,
    verified_trades: metrics.verifiedTrades, wins: metrics.wins, losses: metrics.losses, win_rate: metrics.winRate, median_return: metrics.medianReturn,
    mean_return: metrics.meanReturn, realized_pnl_usd: metrics.realizedPnlUsd, best_trade_percent: metrics.bestTradePercent,
    worst_trade_percent: metrics.worstTradePercent, median_holding_seconds: metrics.medianHoldingSeconds, data_quality: quality,
    max_drawdown: drawdown.maxDrawdownPercent, max_drawdown_usd: drawdown.maxDrawdownUsd, drawdown_status: drawdown.status,
    drawdown_start_at: drawdown.startAt, drawdown_bottom_at: drawdown.bottomAt, drawdown_recovered_at: drawdown.recoveredAt,
    rug_exposure_rate: rugRate, rug_assessed_trades: entryRisks.filter(Boolean).length, risk_data_quality: riskCoverage,
    pricing_coverage: pricingCoverage, liquidity_coverage: liquidityCoverage, metrics: { ...metrics, rugExposure: risk, dataQualityV3, verification } });
  const score = calculateWalletScoreV2({ closedTrades: metrics.closedTrades, verifiedTrades: metrics.verifiedTrades, winRate: metrics.winRate,
    medianReturn: metrics.medianReturn, realizedPnlUsd: metrics.realizedPnlUsd, maxDrawdown: metrics.maxDrawdown, rugExposureRate: risk.rugExposureRate,
    medianHoldingSeconds: metrics.medianHoldingSeconds, overallDataQuality: quality });
  put("wallet_scores", { wallet_id: walletId, score: score.score, data_quality: score.dataQuality,
    scoring_version: score.version, components: { components: score.components, missing_components: score.missingComponents, lifecycle: score.lifecycle },
    calculated_at: publishedAt, data_cutoff_at: now, lifecycle: score.lifecycle });
  const knownCapacity = cycles.filter((item) => item.capacityRisk !== "UNKNOWN");
  const executionQuality = knownCapacity.length ? Math.round(knownCapacity.reduce((sum, item) => sum + ({ LOW: 100, MEDIUM: 70, HIGH: 35, EXTREME: 0 }[item.capacityRisk] ?? 0), 0) / knownCapacity.length) : null;
  const scoreV3 = calculateWalletScoreV3({ verifiedTrades: metrics.verifiedTrades, winRate: metrics.winRate, medianReturn: metrics.medianReturn,
    realizedPnlUsd: metrics.realizedPnlUsd, maxDrawdown: drawdown.maxDrawdownPercent, rugExposureRate: rugRate,
    entryQuality: null, executionQuality, overallDataQuality: dataQualityV3 });
  put("wallet_scores", { wallet_id: walletId, score: scoreV3.score, data_quality: scoreV3.dataQuality,
    scoring_version: scoreV3.version, components: { components: scoreV3.components, missing_components: scoreV3.missingComponents, policy_version: verification.policyVersion },
    calculated_at: publishedAt, data_cutoff_at: now, lifecycle: verification.eligibleStatus });
  put("wallet_verification_evaluations", { wallet_id: walletId,
    policy_version: verification.policyVersion, evaluated_at: publishedAt, data_snapshot_cutoff: now, current_status: score.lifecycle,
    eligible_status: verification.eligibleStatus, requirements_passed: verification.passed, requirements_failed: verification.failed,
    evidence: { verifiedTrades: metrics.verifiedTrades, dataQualityV3, pricingCoverage, liquidityCoverage, riskCoverage, historyDays: Math.floor(historyDays), drawdownStatus: drawdown.status } });
  put("wallet_verification_progress", { wallet_id: walletId, policy_version: progress.policyVersion,
    calculated_at: publishedAt, eligible_status: verification.eligibleStatus, verified_trades: metrics.verifiedTrades,
    required_verified_trades: WALLET_VERIFICATION_POLICY.minimumVerifiedTradeCycles, history_days: Math.floor(historyDays), required_history_days: WALLET_VERIFICATION_POLICY.minimumHistoryDays,
    liquidity_coverage: liquidityCoverage, required_liquidity_coverage: WALLET_VERIFICATION_POLICY.minimumLiquidityCoverage,
    risk_coverage: riskCoverage, required_risk_coverage: WALLET_VERIFICATION_POLICY.minimumRiskCoverage,
    data_quality: dataQualityV3, required_data_quality: WALLET_VERIFICATION_POLICY.minimumOverallDataQuality,
    pricing_coverage: pricingCoverage, required_pricing_coverage: WALLET_VERIFICATION_POLICY.minimumPricingCoverage,
    drawdown_available: drawdown.status === "available", blockers: verification.failed, progress });
    
  return summary;
}
