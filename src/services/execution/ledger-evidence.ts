import type { LedgerFillV2, PendingOrderV2 } from "@/domain/account-ledger-v2";
import { ACCOUNT_LEDGER_V2_VERSION, riskContextFromAccountLedgerV2, verifyAccountLedgerV2Snapshot } from "@/domain/account-ledger-v2";

export function persistedLedgerRisk(row: any, accountId: string | null, cutoffAt: string, maxAgeMs: number) {
  const unknown = { status: "UNKNOWN" as const, openPositions: null, dailyLossSek: null, totalExposureSek: null, availableCashSek: null, availableSellQuantity: null };
  if (!row || !accountId || row.account_id !== accountId || row.ledger_version !== ACCOUNT_LEDGER_V2_VERSION
    || row.status !== "KNOWN" || !Array.isArray(row.unknown_reasons) || row.unknown_reasons.length
    || !verifyAccountLedgerV2Snapshot(row.ledger_payload)) return unknown;
  const payload = row.ledger_payload, cutoff = Date.parse(cutoffAt);
  if (payload.accountId !== accountId || Date.parse(payload.cutoffAt) !== Date.parse(row.information_cutoff_at)
    || Date.parse(payload.economicCutoffAt) !== Date.parse(row.economic_cutoff_at) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return unknown;
  for (const time of [row.available_at, row.information_cutoff_at, row.economic_cutoff_at]) {
    const age = cutoff - Date.parse(time);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return unknown;
  }
  return riskContextFromAccountLedgerV2(payload);
}

export const finiteNumber = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const one = (value: any) => Array.isArray(value) ? value[0] : value;

/** Only direct, evidenced FX. A stablecoin ticker is not a USD exchange rate. */
export function historicalSekRate(currency: string | null, occurredAt: string, cutoffAt: string, rates: any[]) {
  if (!currency || !/^[A-Z0-9]{2,20}$/.test(currency) || !Number.isFinite(Date.parse(occurredAt)) || !Number.isFinite(Date.parse(cutoffAt))) return null;
  if (currency === "SEK") return { rate: 1, reference: "FX:SEK:IDENTITY" };
  const at = Date.parse(occurredAt), cutoff = Date.parse(cutoffAt);
  const candidates = rates.filter(row => row.base_currency === currency && row.quote_currency === "SEK"
    && Date.parse(row.effective_at) <= at && Date.parse(row.available_at) <= cutoff)
    .sort((a, b) => Date.parse(b.effective_at) - Date.parse(a.effective_at) || String(a.id).localeCompare(String(b.id)));
  const row = candidates[0], rate = finiteNumber(row?.rate);
  if (!row || typeof row.id !== "string" || !row.id || !row.source_reference || !row.provider || rate === null || rate <= 0 || Number(row.data_quality) < 80
    || !Number.isFinite(Number(row.data_quality)) || at - Date.parse(row.effective_at) > 7 * 86400_000
    || !Number.isFinite(Date.parse(row.observed_at)) || Date.parse(row.available_at) < Date.parse(row.observed_at)) return null;
  if (candidates.some(other => other.effective_at === row.effective_at && finiteNumber(other.rate) !== rate)) return null;
  return { rate, reference: `fx_observations:${row.id}:${row.provider}:${row.source_reference}` };
}

export function normalizeLedgerFill(row: any, cutoffAt: string, rates: any[]) {
  const quote = historicalSekRate(row.quote_currency, row.occurred_at, cutoffAt, rates);
  const price = finiteNumber(row.price), fee = finiteNumber(row.fee_amount);
  const priceSek = price !== null && quote ? price * quote.rate : null;
  const feeAsset = row.fee_currency === row.quote_currency ? "QUOTE" : row.fee_currency === row.base_currency ? "BASE" : "UNKNOWN";
  const feeSek = fee === null ? null : feeAsset === "QUOTE" && quote ? fee * quote.rate : feeAsset === "BASE" && priceSek !== null ? fee * priceSek : null;
  const fill: LedgerFillV2 = {
    fillId: row.id, accountId: row.account_id, instrumentId: row.instrument_id,
    side: row.side, quantity: finiteNumber(row.quantity) ?? NaN, priceSek, feeSek, feeAsset,
    feeBaseQuantity: feeAsset === "BASE" ? fee : null,
    occurredAt: row.occurred_at, availableAt: row.available_at,
  };
  return { fill, fxReference: quote?.reference ?? null };
}

/** Provider-recorded-time coverage does not attest funding or opening holdings. */
export function contiguousFillCoverage(baselineAt: string | null, states: any[], cutoffAt: string) {
  const baseline = Date.parse(baselineAt ?? ""), cutoff = Date.parse(cutoffAt);
  if (!Number.isFinite(baseline) || baseline > cutoff) return null;
  let through = baseline;
  const ids: string[] = [];
  const completed = states.filter(row => row.status === "COMPLETE_WINDOW" && row.exhausted === true
    && row.source === "OKX_FILLS_HISTORY_3_MONTHS" && row.time_basis === "PROVIDER_RECORDED_AT" && row.retention_limited === false
    && Date.parse(row.effective_start_at) === Date.parse(row.requested_start_at) && Date.parse(row.effective_end_at) === Date.parse(row.requested_end_at)
    && Date.parse(row.observed_at) <= cutoff && Date.parse(row.retention_start_at) <= Date.parse(row.effective_start_at))
    .sort((a, b) => Date.parse(a.requested_start_at) - Date.parse(b.requested_start_at));
  for (const row of completed) {
    const start = Date.parse(row.effective_start_at), end = Date.parse(row.effective_end_at);
    if (Number.isFinite(start) && Number.isFinite(end) && start <= through && end > through && end <= cutoff) {
      through = end; ids.push(row.id);
    }
  }
  return ids.length ? { through: new Date(through).toISOString(), checkpointIds: ids } : null;
}

export function remainingOrderReservation(row: any): PendingOrderV2 {
  const intent = one(row.execution_intents), quantity = finiteNumber(intent?.quantity), filled = finiteNumber(row.filled_quantity);
  const remaining = quantity !== null && quantity > 0 && filled !== null && filled >= 0 && filled <= quantity ? quantity - filled : null;
  const notional = finiteNumber(intent?.quote_amount_sek), feeBuffer = finiteNumber(row.reservation_fee_buffer_sek);
  // A fee cap is explicit configuration; missing is never assumed to be zero.
  return {
    orderId: row.id, accountId: row.account_id, instrumentId: intent?.instrument_id, side: intent?.side,
    remainingQuantity: remaining,
    remainingNotionalSek: remaining !== null && quantity !== null && notional !== null && notional >= 0 && feeBuffer !== null && feeBuffer >= 0 ? notional * remaining / quantity + feeBuffer : null,
    availableAt: row.updated_at,
  };
}
