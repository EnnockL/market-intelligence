import type { SubmissionEvidence } from "@/domain/execution-submission";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";

export function submissionFixture(mode: "SHADOW" | "DEMO" = "SHADOW"): SubmissionEvidence {
  const now = "2026-09-07T12:00:01.000Z", cutoff = "2026-09-07T12:00:00.000Z", provider = mode === "SHADOW" ? "shadow-execution" : "okx-demo";
  const ledger = rebuildAccountLedgerV2({ ...(mode === "DEMO" ? { demoReconciliation: { externalAccountId: "123", instrumentId: "BTC-USDT", quoteCurrency: "USDT", market: { baseCurrency: "BTC", quoteCurrency: "USDT", lotSize: 0.00001, minimumSize: 0.00001, tickSize: 0.1, bid: 50000, ask: 50001, observedAt: cutoff }, quoteSekRate: 2, feeRate: 0.001, evidenceHash: "a".repeat(64) } } : {}), accountId: "account-1", baselineAt: "2026-09-01T00:00:00.000Z", openingCashSek: 1000, openingCashStatus: "DECLARED", historyComplete: true, cutoffAt: cutoff, dailyWindowStartAt: "2026-09-07T00:00:00.000Z", fills: [], marks: [], pendingOrders: [{ orderId: "order-1", accountId: "account-1", instrumentId: "BTC-USDT", side: "BUY", remainingQuantity: 0.001, remainingNotionalSek: 100, availableAt: cutoff }] });
  return {
    order: { id: "order-1", intent_id: "intent-1", safety_evaluation_id: "safety-1", provider, provider_environment: mode, account_id: "account-1" },
    provider: { name: provider, mode }, checkedAt: now,
    control: { control_key: "global", revision: 1, mode, provider, kill_switch: false, new_orders_enabled: true, live_execution_enabled: false, provider_status: "HEALTHY", limits: { minOrderSek: 10, maxOrderSek: 100, maxOpenPositions: 1, maxDailyLossSek: 100, maxTotalExposureSek: 200, maxDataAgeMs: 15000, maxSlippageBps: 50 } },
    account: { id: "account-1", revision: 1, account_key: mode === "SHADOW" ? "shadow-primary" : `${provider}-primary`, provider, provider_environment: mode, status: "ACTIVE", ...(mode === "DEMO" ? { provider_account_id: "123" } : {}) },
    risk: { id: "risk-1", account_id: "account-1", status: ledger.status, ledger_version: ledger.version, ledger_payload: ledger, cash_sek: ledger.cashSek, open_positions: ledger.openPositions, realized_pnl_sek: ledger.realizedPnlSek, reserved_exposure_sek: ledger.reservedBuySek, economic_cutoff_at: ledger.economicCutoffAt, information_cutoff_at: cutoff, available_at: cutoff, unknown_reasons: ledger.unknownReasons },
    observation: { id: "observation-1", account_id: "account-1", provider, provider_environment: mode, data_status: mode === "SHADOW" ? "UNKNOWN" : "KNOWN", observed_at: cutoff, available_at: cutoff },
    safety: { id: "safety-1", intent_id: "intent-1", decision: "PASSED", policy_version: "execution-safety-policy-v2", information_cutoff_at: cutoff, available_at: cutoff, context: { instrumentType: "SPOT", leverage: 1, dataAgeMs: 500, criticalSafety: "PASS", liquidityStatus: "PASS", riskStatus: "PASS" } },
    health: { status: "HEALTHY", credentialsValid: true, tradePermission: true, withdrawPermission: false, ...(mode === "DEMO" ? { externalAccountId: "123" } : {}) },
    intent: { sourceType: "trade_eligibility", sourceId: "evaluation-1", assetId: "asset-1", instrumentId: "BTC-USDT", side: "BUY", orderType: "LIMIT", quoteAmountSek: 100, quantity: 0.001, limitPrice: 50000, stopPrice: 45000, targetPrice: 55000, maxSlippageBps: 25, informationCutoffAt: cutoff, availableAt: cutoff, expiresAt: "2026-09-07T12:01:00.000Z", evidenceRefs: ["eligibility:evaluation-1"], consensusVersion: null, forecastVersion: null, riskVersion: ledger.version },
  };
}
