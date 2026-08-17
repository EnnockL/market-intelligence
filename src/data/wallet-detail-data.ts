import { createServiceClient } from "../lib/supabase/server";

export interface WalletDetailMetric {
  closedTrades: number; verifiedTrades: number; wins: number; losses: number; winRate: number | null;
  medianReturn: number | null; realizedPnlUsd: number | null; dataQuality: number; calculatedAt: string;
  maxDrawdown: number | null; rugExposureRate: number | null; rugAssessedTrades: number; riskDataQuality: number;
  pricingCoverage: number; liquidityCoverage: number;
}
export interface WalletDetailCycle {
  id: string; symbol: string; status: "open" | "closed" | "incomplete"; quantity: number;
  investedUsd: number | null; proceedsUsd: number | null; realizedPnlUsd: number | null; returnPercent: number | null;
  firstEntryAt: string; finalExitAt: string | null; dataQuality: number; pricingCompleteness: number; executionCompleteness: number;
}
export interface WalletDetailTransaction {
  id: string; signature: string; side: string; symbol: string; quantity: number | null; occurredAt: string;
  enrichmentStatus: "complete" | "partial" | "incomplete" | "missing"; estimatedValueUsd: number | null; feeUsd: number | null;
}
export interface WalletDetailData {
  address: string; found: boolean; tracked: boolean; label: string | null;
  discovery: { status: string; score: number; dataQuality: number; riskFlags: string[]; reasons: string[]; lastObservedAt: string } | null;
  metric: WalletDetailMetric | null; cycles: WalletDetailCycle[]; transactions: WalletDetailTransaction[];
  scoreV3: { score: number; dataQuality: number; lifecycle: string } | null;
  verification: { eligibleStatus: string; failed: string[]; passed: string[]; policyVersion: string } | null;
  mode: "live" | "degraded"; message: string;
}

type Numeric = number | string | null;
export function numberOrNull(value: Numeric): number | null { if (value === null) return null; const result = Number(value); return Number.isFinite(result) ? result : null; }

export async function getWalletDetailData(address: string): Promise<WalletDetailData> {
  const fallback = (message: string): WalletDetailData => ({ address, found: false, tracked: false, label: null, discovery: null, metric: null, cycles: [], transactions: [], scoreV3: null, verification: null, mode: "degraded", message });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback("Wallet intelligence is not configured");
  try {
    const db = createServiceClient();
    const [{ data: candidate, error: candidateError }, { data: wallet, error: walletError }] = await Promise.all([
      db.from("wallet_discovery_candidates").select("status,score,data_quality,risk_flags,reasons,last_observed_at").eq("chain", "solana").eq("address", address).maybeSingle(),
      db.from("wallets").select("id,label,is_tracked").eq("chain", "solana").eq("address", address).maybeSingle(),
    ]);
    if (candidateError) throw candidateError; if (walletError) throw walletError;
    if (!candidate && !wallet) return fallback("Wallet not found in discovery or tracked wallets");
    let metric: WalletDetailMetric | null = null; let cycles: WalletDetailCycle[] = []; let transactions: WalletDetailTransaction[] = []; let scoreV3: WalletDetailData["scoreV3"] = null; let verification: WalletDetailData["verification"] = null;
    if (wallet) {
      const [{ data: metricRow, error: metricError }, { data: cycleRows, error: cycleError }, { data: transactionRows, error: transactionError }, { data: scoreRow, error: scoreError }, { data: verificationRow, error: verificationError }] = await Promise.all([
        db.from("wallet_metric_snapshots").select("closed_trades,verified_trades,wins,losses,win_rate,median_return,realized_pnl_usd,data_quality,calculated_at,max_drawdown,rug_exposure_rate,rug_assessed_trades,risk_data_quality,pricing_coverage,liquidity_coverage").eq("wallet_id", wallet.id).order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("wallet_trade_cycles").select("id,status,quantity,invested_usd,proceeds_usd,realized_pnl_usd,return_percent,first_entry_at,final_exit_at,data_quality,pricing_completeness,execution_completeness,assets(symbol)").eq("wallet_id", wallet.id).order("first_entry_at", { ascending: false }).limit(30),
        db.from("wallet_transactions").select("id,transaction_hash,side,quantity,occurred_at,assets(symbol)").eq("wallet_id", wallet.id).order("occurred_at", { ascending: false }).limit(30),
        db.from("wallet_scores").select("score,data_quality,lifecycle").eq("wallet_id", wallet.id).eq("scoring_version", "wallet-score-v3").order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("wallet_verification_evaluations").select("eligible_status,requirements_failed,requirements_passed,policy_version").eq("wallet_id", wallet.id).order("evaluated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (metricError) throw metricError; if (cycleError) throw cycleError; if (transactionError) throw transactionError; if (scoreError) throw scoreError; if (verificationError) throw verificationError;
      metric = metricRow ? { closedTrades: metricRow.closed_trades, verifiedTrades: metricRow.verified_trades, wins: metricRow.wins, losses: metricRow.losses,
        winRate: numberOrNull(metricRow.win_rate), medianReturn: numberOrNull(metricRow.median_return), realizedPnlUsd: numberOrNull(metricRow.realized_pnl_usd), dataQuality: metricRow.data_quality, calculatedAt: metricRow.calculated_at,
        maxDrawdown: numberOrNull(metricRow.max_drawdown), rugExposureRate: numberOrNull(metricRow.rug_exposure_rate),
        rugAssessedTrades: metricRow.rug_assessed_trades, riskDataQuality: metricRow.risk_data_quality,
        pricingCoverage: metricRow.pricing_coverage, liquidityCoverage: metricRow.liquidity_coverage } : null;
      scoreV3 = scoreRow ? { score: scoreRow.score, dataQuality: scoreRow.data_quality, lifecycle: scoreRow.lifecycle } : null;
      verification = verificationRow ? { eligibleStatus: verificationRow.eligible_status, failed: strings(verificationRow.requirements_failed), passed: strings(verificationRow.requirements_passed), policyVersion: verificationRow.policy_version } : null;
      cycles = (cycleRows ?? []).map((row) => ({ id: row.id, symbol: relatedSymbol(row.assets), status: row.status, quantity: Number(row.quantity),
        investedUsd: numberOrNull(row.invested_usd), proceedsUsd: numberOrNull(row.proceeds_usd), realizedPnlUsd: numberOrNull(row.realized_pnl_usd),
        returnPercent: numberOrNull(row.return_percent), firstEntryAt: row.first_entry_at, finalExitAt: row.final_exit_at, dataQuality: row.data_quality,
        pricingCompleteness: row.pricing_completeness, executionCompleteness: row.execution_completeness }));
      const txIds = (transactionRows ?? []).map((row) => row.id);
      const { data: enrichmentRows, error: enrichmentError } = txIds.length ? await db.from("wallet_transaction_enrichments").select("wallet_transaction_id,status,estimated_value_usd,fee_usd,known_at").in("wallet_transaction_id", txIds).order("known_at", { ascending: false }) : { data: [], error: null };
      if (enrichmentError) throw enrichmentError; const enrichmentByTx = new Map<string, { status: "complete" | "partial" | "incomplete"; estimated_value_usd: Numeric; fee_usd: Numeric }>();
      for (const item of enrichmentRows ?? []) if (!enrichmentByTx.has(item.wallet_transaction_id)) enrichmentByTx.set(item.wallet_transaction_id, item as never);
      transactions = (transactionRows ?? []).map((row) => { const enrichment = enrichmentByTx.get(row.id); return { id: row.id, signature: row.transaction_hash,
        side: row.side ?? "other", symbol: relatedSymbol(row.assets), quantity: numberOrNull(row.quantity), occurredAt: row.occurred_at,
        enrichmentStatus: enrichment?.status ?? "missing", estimatedValueUsd: numberOrNull(enrichment?.estimated_value_usd ?? null), feeUsd: numberOrNull(enrichment?.fee_usd ?? null) }; });
    }
    return { address, found: true, tracked: Boolean(wallet?.is_tracked), label: wallet?.label ?? null,
      discovery: candidate ? { status: candidate.status, score: candidate.score, dataQuality: candidate.data_quality,
        riskFlags: strings(candidate.risk_flags), reasons: strings(candidate.reasons), lastObservedAt: candidate.last_observed_at } : null,
      metric, cycles, transactions, scoreV3, verification, mode: "live", message: metric?.verifiedTrades ? `${metric.verifiedTrades} verified trades` : "Evidence incomplete; verification blockers are shown below" };
  } catch (error) { return fallback(`Wallet data unavailable: ${error instanceof Error ? error.message : "unknown error"}`); }
}

function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function relatedSymbol(value: unknown): string { if (Array.isArray(value)) return String((value[0] as { symbol?: unknown } | undefined)?.symbol ?? "UNKNOWN"); return String((value as { symbol?: unknown } | null)?.symbol ?? "UNKNOWN"); }
