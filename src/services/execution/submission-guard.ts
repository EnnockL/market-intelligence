import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionIntentInput } from "@/domain/execution";
import { evaluateSubmissionEvidence } from "@/domain/execution-submission";
import type { ExecutionProvider } from "./provider";
import { riskContextFromAccountLedgerV2, verifyAccountLedgerV2Snapshot } from "@/domain/account-ledger-v2";

export interface QueuedExecutionOrder {
  id: string; account_id: string | null; intent_id: string; safety_evaluation_id: string; provider: string; provider_environment: string;
  client_order_id: string; provider_order_id: string | null; execution_intents: Record<string, any> | Array<Record<string, any>>;
}

export async function checkQueuedExecution(db: SupabaseClient, provider: ExecutionProvider, order: QueuedExecutionOrder) {
  if (order.provider_order_id !== null) return { decision: "BLOCKED" as const, reason: "FINAL_PROVIDER_ORDER_ALREADY_EXISTS" };
  const accountKey = provider.mode === "SHADOW" ? "shadow-primary" : `${provider.name}-primary`;
  const [control, account, safety] = await Promise.all([
    db.from("execution_controls").select("control_key,revision,mode,provider,kill_switch,new_orders_enabled,live_execution_enabled,provider_status,limits").eq("control_key", "global").maybeSingle(),
    db.from("execution_accounts").select("id,revision,account_key,provider,provider_environment,status,provider_account_id,demo_baseline").eq("account_key", accountKey).maybeSingle(),
    db.from("execution_safety_evaluations").select("id,intent_id,decision,policy_version,context,information_cutoff_at,available_at").eq("id", order.safety_evaluation_id).maybeSingle(),
  ]);
  if ([control, account, safety].some(result => result.error)) throw new Error("FINAL_GUARD_READ_FAILED");
  // Avoid any provider call when the authoritative control is absent/disabled.
  if (!control.data || control.data.kill_switch !== false || control.data.new_orders_enabled !== true || control.data.live_execution_enabled !== false) return { decision: "BLOCKED" as const, reason: !control.data ? "FINAL_CONTROL_UNKNOWN" : control.data.kill_switch !== false ? "FINAL_KILL_SWITCH_ACTIVE" : control.data.live_execution_enabled !== false ? "FINAL_LIVE_EXECUTION_FORBIDDEN" : "FINAL_NEW_ORDERS_DISABLED" };
  if (!account.data) return { decision: "BLOCKED" as const, reason: "FINAL_ACCOUNT_UNKNOWN" };
  if (order.account_id !== account.data.id) return { decision: "BLOCKED" as const, reason: "FINAL_ACCOUNT_MISMATCH" };
  const cutoffAt = new Date().toISOString();
  const [risk, observation] = await Promise.all([
    db.from("risk_ledger_snapshots").select("id,account_id,ledger_version,ledger_payload,status,cash_sek,open_positions,realized_pnl_sek,daily_realized_pnl_sek,reserved_exposure_sek,gross_exposure_sek,available_cash_sek,economic_cutoff_at,information_cutoff_at,available_at,unknown_reasons").eq("account_id", account.data.id).lte("available_at", cutoffAt).order("information_cutoff_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    db.from("account_state_observations").select("id,account_id,provider,provider_environment,data_status,observed_at,available_at").eq("account_id", account.data.id).lte("available_at", cutoffAt).order("observed_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (risk.error || observation.error) throw new Error("FINAL_GUARD_READ_FAILED");
  const rawIntent = Array.isArray(order.execution_intents) ? order.execution_intents[0] : order.execution_intents;
  if (!rawIntent) return { decision: "BLOCKED" as const, reason: "FINAL_INTENT_UNKNOWN" };
  let health: Awaited<ReturnType<ExecutionProvider["health"]>>;
  try { health = await provider.health(); }
  catch { return { decision: "BLOCKED" as const, reason: "FINAL_PROVIDER_HEALTH_UNKNOWN" }; }
  if (provider.mode === "DEMO") {
    const payload = risk.data?.ledger_payload;
    if (!account.data.provider_account_id || health.externalAccountId !== account.data.provider_account_id || !verifyAccountLedgerV2Snapshot(payload)
      || payload.demoReconciliation?.externalAccountId !== account.data.provider_account_id) return { decision: "BLOCKED" as const, reason: "FINAL_DEMO_ACCOUNT_NOT_RECONCILED" };
    const evidence = payload.demoReconciliation!, intent = persistedExecutionIntent(rawIntent);
    if (evidence.instrumentId !== intent.instrumentId || intent.orderType !== "LIMIT" || !(intent.quantity! > 0) || !(intent.limitPrice! > 0)
      || !Number.isFinite(evidence.quoteSekRate) || evidence.quoteSekRate <= 0 || !Number.isFinite(evidence.feeRate) || evidence.feeRate < 0) return { decision: "BLOCKED" as const, reason: "FINAL_DEMO_INSTRUMENT_OR_PRICE_UNKNOWN" };
    const notional = intent.quantity! * intent.limitPrice! * evidence.quoteSekRate;
    if (!Number.isFinite(notional) || Math.abs(notional - intent.quoteAmountSek) > Math.max(0.01, notional * 0.0001)) return { decision: "BLOCKED" as const, reason: "FINAL_DEMO_NOTIONAL_MISMATCH" };
    const market=evidence.market;
    const multiple=(value:number,step:number)=>Number.isFinite(step)&&step>0&&Math.abs(value/step-Math.round(value/step))<1e-7;
    if (!market || market.quoteCurrency!==evidence.quoteCurrency || `${market.baseCurrency}-${market.quoteCurrency}`!==intent.instrumentId
      || !multiple(intent.quantity!,market.lotSize) || !multiple(intent.limitPrice!,market.tickSize) || intent.quantity!<market.minimumSize)
      return {decision:"BLOCKED" as const,reason:"FINAL_DEMO_VENUE_RULES_UNKNOWN"};
    const available = riskContextFromAccountLedgerV2(payload, order.id);
    if (intent.side === "BUY" && (available.availableCashSek === null || available.availableCashSek < notional * (1 + evidence.feeRate))) return { decision: "BLOCKED" as const, reason: "FINAL_DEMO_FEE_BUFFER_REQUIRED" };
  }
  return evaluateSubmissionEvidence({ order, intent: persistedExecutionIntent(rawIntent), provider, control: control.data, account: account.data, risk: risk.data, observation: observation.data, safety: safety.data, health, checkedAt: new Date().toISOString() });
}

export function persistedExecutionIntent(value: Record<string, any>): ExecutionIntentInput {
  const number = (input: unknown) => input === null || input === undefined ? null : Number(input);
  return {
    sourceType: value.source_type, sourceId: value.source_id, assetId: value.asset_id, instrumentId: value.instrument_id,
    side: value.side, orderType: value.order_type, quoteAmountSek: Number(value.quote_amount_sek), quantity: number(value.quantity),
    limitPrice: number(value.limit_price), stopPrice: number(value.stop_price), targetPrice: number(value.target_price), maxSlippageBps: Number(value.max_slippage_bps),
    informationCutoffAt: value.information_cutoff_at, availableAt: value.available_at, expiresAt: value.expires_at,
    evidenceRefs: value.evidence_refs, consensusVersion: value.consensus_version, forecastVersion: value.forecast_version,
    riskVersion: value.risk_version, strategyAttributionId: value.strategy_attribution_id ?? null,
  };
}
