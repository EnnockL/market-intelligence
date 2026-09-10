import { z } from "zod";
import { createExecutionIntent, evaluateExecutionSafety, EXECUTION_SAFETY_POLICY_VERSION, type ExecutionIntentInput, type SafetyContext } from "./execution";
import { ACCOUNT_LEDGER_V2_VERSION, riskContextFromAccountLedgerV2, verifyAccountLedgerV2Snapshot } from "./account-ledger-v2";

export const EXECUTION_SUBMISSION_GUARD_VERSION = "execution-submission-guard-v1";
const number = z.preprocess(value => typeof value === "string" && value.trim() ? Number(value) : value, z.number().finite());
const revision = number.pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const timestamp = z.string().datetime({ offset: true });
const limitsSchema = z.object({
  minOrderSek: z.number().finite().positive(), maxOrderSek: z.number().finite().positive(),
  maxOpenPositions: z.number().int().positive(), maxDailyLossSek: z.number().finite().positive(),
  maxTotalExposureSek: z.number().finite().positive(), maxDataAgeMs: z.number().finite().positive(),
  maxSlippageBps: z.number().finite().nonnegative(),
}).refine(value => value.minOrderSek <= value.maxOrderSek);
const mode = z.enum(["SHADOW", "DEMO"]);
const controlSchema = z.object({ control_key: z.literal("global"), revision, mode, provider: z.string().min(1), kill_switch: z.boolean(), new_orders_enabled: z.boolean(), live_execution_enabled: z.boolean(), provider_status: z.enum(["HEALTHY", "DEGRADED", "FAILED", "UNKNOWN"]), limits: limitsSchema });
const accountSchema = z.object({ id: z.string().min(1), revision, account_key: z.string().min(1), provider: z.string().min(1), provider_environment: mode, status: z.enum(["ACTIVE", "PAUSED"]) });
const riskSchema = z.object({ id: z.string().min(1), account_id: z.string().min(1), ledger_version: z.literal(ACCOUNT_LEDGER_V2_VERSION), ledger_payload: z.unknown(), status: z.enum(["KNOWN", "UNKNOWN"]), cash_sek: number.nullable(), open_positions: number.nullable(), realized_pnl_sek: number.nullable(), reserved_exposure_sek: number.nullable(), information_cutoff_at: timestamp, economic_cutoff_at: timestamp, available_at: timestamp, unknown_reasons: z.array(z.string()) });
const observationSchema = z.object({ id: z.string().min(1), account_id: z.string().min(1), provider: z.string().min(1), provider_environment: mode, data_status: z.enum(["KNOWN", "PARTIAL", "UNKNOWN"]), observed_at: timestamp, available_at: timestamp });
const contextSchema = z.object({
  instrumentType: z.enum(["SPOT", "MARGIN", "FUTURES", "UNKNOWN"]), leverage: z.number().finite().nonnegative().nullable(),
  dataAgeMs: z.number().finite().nonnegative().nullable(),
  criticalSafety: z.enum(["PASS", "FAIL", "UNKNOWN"]), liquidityStatus: z.enum(["PASS", "FAIL", "UNKNOWN"]), riskStatus: z.enum(["PASS", "FAIL", "UNKNOWN"]),
});
const safetySchema = z.object({ id: z.string().min(1), intent_id: z.string().min(1), decision: z.literal("PASSED"), policy_version: z.literal(EXECUTION_SAFETY_POLICY_VERSION), context: contextSchema, information_cutoff_at: timestamp, available_at: timestamp });
const healthSchema = z.object({ status: z.enum(["HEALTHY", "DEGRADED", "FAILED"]), credentialsValid: z.boolean(), tradePermission: z.boolean(), withdrawPermission: z.boolean().nullable() });

export interface SubmissionEvidence {
  order: { id: string; intent_id: string; safety_evaluation_id: string; provider: string; provider_environment: string; account_id?: string | null };
  intent: ExecutionIntentInput;
  provider: { name: string; mode: "SHADOW" | "DEMO" };
  control: unknown; account: unknown; risk: unknown; observation: unknown; safety: unknown; health: unknown;
  checkedAt: string;
}

/** Re-evaluate queued approval; missing/malformed/UNKNOWN inputs never inherit PASS. */
export function evaluateSubmissionEvidence(input: SubmissionEvidence) {
  const deny = (reason: string) => ({ decision: "BLOCKED" as const, reason });
  const control = controlSchema.safeParse(input.control), account = accountSchema.safeParse(input.account), risk = riskSchema.safeParse(input.risk), observation = observationSchema.safeParse(input.observation), safety = safetySchema.safeParse(input.safety), health = healthSchema.safeParse(input.health);
  if (!control.success) return deny("FINAL_CONTROL_UNKNOWN");
  if (control.data.kill_switch !== false) return deny("FINAL_KILL_SWITCH_ACTIVE");
  if (control.data.new_orders_enabled !== true) return deny("FINAL_NEW_ORDERS_DISABLED");
  if (control.data.live_execution_enabled !== false) return deny("FINAL_LIVE_EXECUTION_FORBIDDEN");
  if (control.data.mode !== input.provider.mode || control.data.provider !== input.provider.name || input.order.provider !== input.provider.name || input.order.provider_environment !== input.provider.mode) return deny("FINAL_PROVIDER_MODE_MISMATCH");
  if (control.data.provider_status !== "HEALTHY") return deny("FINAL_PROVIDER_UNAVAILABLE");
  if (!account.success) return deny("FINAL_ACCOUNT_UNKNOWN");
  if (account.data.status !== "ACTIVE") return deny("FINAL_ACCOUNT_PAUSED");
  const accountKey = input.provider.mode === "SHADOW" ? "shadow-primary" : `${input.provider.name}-primary`;
  if (account.data.provider !== input.provider.name || account.data.provider_environment !== input.provider.mode || account.data.account_key !== accountKey) return deny("FINAL_ACCOUNT_MISMATCH");
  if (input.order.account_id !== account.data.id) return deny("FINAL_ORDER_ACCOUNT_MISMATCH");
  if (!risk.success || risk.data.status !== "KNOWN" || risk.data.unknown_reasons.length || risk.data.account_id !== account.data.id) return deny("FINAL_RISK_UNKNOWN");
  const ledger = risk.data.ledger_payload;
  if (!verifyAccountLedgerV2Snapshot(ledger) || ledger.status !== "KNOWN" || ledger.unknownReasons.length) return deny("FINAL_LEDGER_PAYLOAD_INVALID");
  if (ledger.accountId !== account.data.id || Date.parse(ledger.cutoffAt) !== Date.parse(risk.data.information_cutoff_at)
    || Date.parse(ledger.economicCutoffAt) !== Date.parse(risk.data.economic_cutoff_at)
    || risk.data.cash_sek !== ledger.cashSek || risk.data.open_positions !== ledger.openPositions
    || risk.data.realized_pnl_sek !== ledger.realizedPnlSek || risk.data.reserved_exposure_sek !== ledger.reservedBuySek) return deny("FINAL_LEDGER_PAYLOAD_MISMATCH");
  const ledgerContext = riskContextFromAccountLedgerV2(ledger, input.order.id);
  if (ledgerContext.status !== "KNOWN") return deny("FINAL_RISK_UNKNOWN");
  if (!observation.success || observation.data.account_id !== account.data.id || observation.data.provider !== input.provider.name || observation.data.provider_environment !== input.provider.mode) return deny("FINAL_ACCOUNT_OBSERVATION_UNKNOWN");
  // Shadow has no external balance by design. It still requires an ACTIVE,
  // revisioned account and a fresh KNOWN declared-capital risk snapshot.
  if (input.provider.mode === "DEMO" && observation.data.data_status !== "KNOWN") return deny("FINAL_ACCOUNT_OBSERVATION_UNKNOWN");
  if (!safety.success || safety.data.id !== input.order.safety_evaluation_id || safety.data.intent_id !== input.order.intent_id) return deny("FINAL_SAFETY_EVIDENCE_UNKNOWN");
  if (!health.success) return deny("FINAL_PROVIDER_HEALTH_UNKNOWN");
  const intent = input.intent;
  if (!["BUY", "SELL"].includes(intent.side) || !["MARKET", "LIMIT"].includes(intent.orderType)
    || !Number.isFinite(intent.quoteAmountSek) || intent.quoteAmountSek <= 0
    || !Number.isFinite(intent.maxSlippageBps) || intent.maxSlippageBps < 0
    || (intent.quantity !== null && (!Number.isFinite(intent.quantity) || intent.quantity <= 0))
    || (input.provider.mode === "DEMO" && intent.quantity === null)
    || intent.stopPrice === null || !Number.isFinite(intent.stopPrice) || intent.stopPrice <= 0
    || intent.targetPrice === null || !Number.isFinite(intent.targetPrice) || intent.targetPrice <= 0
    || (intent.orderType === "LIMIT" && (intent.limitPrice === null || !Number.isFinite(intent.limitPrice) || intent.limitPrice <= 0))
    || !Array.isArray(intent.evidenceRefs) || !Number.isFinite(Date.parse(intent.availableAt))) return deny("FINAL_INTENT_INVALID");
  const now = Date.parse(input.checkedAt), cutoff = Date.parse(input.intent.informationCutoffAt), expires = Date.parse(input.intent.expiresAt);
  if (![now, cutoff, expires].every(Number.isFinite) || cutoff > now || Date.parse(safety.data.available_at) > now || Date.parse(safety.data.information_cutoff_at) !== cutoff) return deny("FINAL_POINT_IN_TIME_INVALID");
  if (expires <= now) return deny("FINAL_INTENT_EXPIRED");
  for (const source of [risk.data.available_at, risk.data.information_cutoff_at, risk.data.economic_cutoff_at, observation.data.available_at, observation.data.observed_at]) {
    const age = now - Date.parse(source);
    if (age < 0 || age > control.data.limits.maxDataAgeMs) return deny("FINAL_ACCOUNT_OR_RISK_STALE");
  }
  if (intent.side === "SELL" && (intent.quantity === null || !ledgerContext.availableSellQuantity || (ledgerContext.availableSellQuantity[intent.instrumentId] ?? -1) < intent.quantity)) return deny("FINAL_SELL_QUANTITY_UNAVAILABLE");
  const context: SafetyContext = {
    ...safety.data.context, mode: input.provider.mode, killSwitch: control.data.kill_switch,
    newOrdersEnabled: control.data.new_orders_enabled, liveExecutionEnabled: control.data.live_execution_enabled,
    providerStatus: health.data.status, credentialsValid: health.data.credentialsValid, tradePermission: health.data.tradePermission, withdrawPermission: health.data.withdrawPermission,
    openPositions: ledgerContext.openPositions, dailyLossSek: ledgerContext.dailyLossSek,
    totalExposureSek: ledgerContext.totalExposureSek, availableCashSek: ledgerContext.availableCashSek,
    dataAgeMs: safety.data.context.dataAgeMs === null ? null : safety.data.context.dataAgeMs + now - cutoff,
  };
  if ((context.openPositions !== null && (!Number.isInteger(context.openPositions) || context.openPositions < 0)) || (context.totalExposureSek !== null && context.totalExposureSek < 0)) return deny("FINAL_RISK_UNKNOWN");
  let result: ReturnType<typeof evaluateExecutionSafety>;
  try { result = evaluateExecutionSafety(createExecutionIntent(input.intent), context, control.data.limits); }
  catch { return deny("FINAL_INTENT_INVALID"); }
  if (result.decision !== "PASSED") return deny(`FINAL_${result.requirements.find(item => item.status !== "PASS")?.code ?? "SAFETY_BLOCKED"}`);
  return {
    ...result, decision: "PASSED" as const, reason: "FINAL_SAFETY_PASSED", guardVersion: EXECUTION_SUBMISSION_GUARD_VERSION,
    checkedAt: input.checkedAt, controlRevision: control.data.revision, accountId: account.data.id, accountRevision: account.data.revision,
    riskSnapshotId: risk.data.id, accountObservationId: observation.data.id, safetyEvaluationId: safety.data.id,
    dataAgeMs: context.dataAgeMs!,
  };
}
