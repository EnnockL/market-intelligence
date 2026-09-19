import { deterministicDigest } from "./events";

export const ACCOUNT_LEDGER_V2_VERSION = "account-ledger-v2";
export const ACCOUNT_LEDGER_V2_POLICY = {
  costBasis: "WEIGHTED_AVERAGE_PER_INSTRUMENT",
  feeConvention: "SIGNED_DEBIT_POSITIVE_REBATE_NEGATIVE",
  openingBoundary: "DECLARED_CASH_ZERO_INVENTORY_NO_UNRECORDED_TRANSFERS",
  defaultMarkMaxAgeMs: 300_000,
} as const;

export interface LedgerFillV2 {
  fillId: string;
  accountId: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** Historical, evidenced conversion at this fill, never today's FX rate. */
  priceSek: number | null;
  /** Signed fee value. BASE fees are informational here, not another cash debit. */
  feeSek: number | null;
  feeAsset: "QUOTE" | "BASE" | "UNKNOWN";
  /** Signed base quantity: debit positive, rebate negative; null/0 for QUOTE. */
  feeBaseQuantity: number | null;
  occurredAt: string;
  availableAt: string;
}

export interface LedgerMarkV2 {
  instrumentId: string;
  priceSek: number | null;
  observedAt: string;
  availableAt: string;
}

export interface PendingOrderV2 {
  orderId: string;
  accountId: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  /** Remaining, not original, base quantity. Required for SELL. */
  remainingQuantity: number | null;
  /** Remaining BUY cash commitment, including any caller-supplied fee buffer. */
  remainingNotionalSek: number | null;
  availableAt: string;
}

export interface AccountLedgerV2Input {
  /** Market-value reference at an observed opening boundary, never historical purchase cost. */
  openingInventory?: Array<{ instrumentId: string; quantity: number; referencePriceSek: number }>;
  /** Current cash independently reconstructed in native currency and matched to provider bills/balances. */
  cashReconciliation?: { cashSek: number; evidenceHash: string };
  demoReconciliation?: { externalAccountId: string; instrumentId: string; quoteCurrency: string; quoteSekRate: number; feeRate: number; evidenceHash: string; market?: import("./demo-market-proposal").DemoExecutionMarket };
  accountId: string;
  baselineAt: string | null;
  openingCashSek: number | null;
  openingCashStatus: "DECLARED" | "UNKNOWN";
  /** All fills since the declared zero-inventory boundary, without gaps/transfers. */
  historyComplete: boolean;
  /** Knowledge cutoff; historical events may arrive after the economic boundary. */
  cutoffAt: string;
  economicCutoffAt?: string;
  dailyWindowStartAt: string;
  fills: LedgerFillV2[];
  marks: LedgerMarkV2[];
  /** null means the remaining-order inventory could not be completely read. */
  pendingOrders: PendingOrderV2[] | null;
  /** Exclude just the queued order being checked, not its already executed fills. */
  excludeOrderId?: string | null;
  markMaxAgeMs?: number;
  externalUnknownReasons?: string[];
}

export interface AccountLedgerPositionV2 {
  instrumentId: string;
  quantity: number | null;
  costBasisSek: number | null;
  averageCostSek: number | null;
  realizedPnlSek: number | null;
  markPriceSek: number | null;
  marketValueSek: number | null;
  reservedSellQuantity: number | null;
  availableQuantity: number | null;
}

export interface AccountLedgerSnapshotV2 {
  pnlScope?: "SINCE_OBSERVED_BASELINE_NOT_HISTORICAL_COST";
  demoReconciliation?: AccountLedgerV2Input["demoReconciliation"];
  version: typeof ACCOUNT_LEDGER_V2_VERSION;
  accountId: string;
  baselineAt: string | null;
  cutoffAt: string;
  economicCutoffAt: string;
  dailyWindowStartAt: string;
  status: "KNOWN" | "UNKNOWN";
  cashSek: number | null;
  /** Lifetime here means since baselineAt, not an inferred external account lifetime. */
  realizedPnlSek: number | null;
  dailyRealizedPnlSek: number | null;
  /** Net signed fees = grossFeesSek - rebatesSek. Not subtracted from PnL again. */
  feesSek: number | null;
  grossFeesSek: number | null;
  rebatesSek: number | null;
  dailyFeesSek: number | null;
  positions: AccountLedgerPositionV2[];
  grossExposureSek: number | null;
  reservedBuySek: number | null;
  availableCashSek: number | null;
  openPositions: number | null;
  excludedOrderId: string | null;
  /** Remaining reservation facts retained so each queued order can exclude itself. */
  pendingOrders: PendingOrderV2[] | null;
  unknownReasons: string[];
  inputHash: string;
  snapshotKey: string;
  resultHash: string;
}

type Inventory = { quantity: number; cost: number; realized: number };

/** Pure, deterministic spot ledger. Any unresolved input blocks risk eligibility. */
export function rebuildAccountLedgerV2(input: AccountLedgerV2Input): AccountLedgerSnapshotV2 {
  const reasons = new Set<string>();
  const ledgerReasons = new Set<string>();
  const reservationReasons = new Set<string>();
  const ledgerUnknown = (reason: string) => { ledgerReasons.add(reason); reasons.add(reason); };
  const reservationUnknown = (reason: string) => { reservationReasons.add(reason); reasons.add(reason); };
  const cutoff = timestamp(input.cutoffAt), baseline = timestamp(input.baselineAt);
  const economicCutoffAt = input.economicCutoffAt ?? input.cutoffAt;
  const economicCutoff = timestamp(economicCutoffAt);
  const dayStart = timestamp(input.dailyWindowStartAt);
  const maxMarkAge = input.markMaxAgeMs ?? ACCOUNT_LEDGER_V2_POLICY.defaultMarkMaxAgeMs;
  if (!identifier(input.accountId)) ledgerUnknown("ACCOUNT_ID_UNKNOWN");
  if (!Number.isFinite(cutoff)) ledgerUnknown("CUTOFF_INVALID");
  if (!Number.isFinite(economicCutoff) || economicCutoff > cutoff) ledgerUnknown("ECONOMIC_CUTOFF_INVALID");
  if (!Number.isFinite(baseline) || baseline > economicCutoff) ledgerUnknown("BASELINE_INVALID");
  if (!Number.isFinite(dayStart) || dayStart > economicCutoff) ledgerUnknown("DAILY_WINDOW_INVALID");
  if (input.openingCashStatus !== "DECLARED" || !nonNegative(input.openingCashSek)) ledgerUnknown("OPENING_CASH_NOT_DECLARED");
  if (input.historyComplete !== true) ledgerUnknown("FILL_HISTORY_INCOMPLETE");
  if (input.cashReconciliation && (!nonNegative(input.cashReconciliation.cashSek) || !/^[a-f0-9]{64}$/.test(input.cashReconciliation.evidenceHash))) ledgerUnknown("CASH_RECONCILIATION_INVALID");
  if (!finite(maxMarkAge) || maxMarkAge < 0) reasons.add("MARK_MAX_AGE_INVALID");
  if (!Array.isArray(input.fills)) ledgerUnknown("FILLS_UNAVAILABLE");
  if (!Array.isArray(input.marks)) reasons.add("MARKS_UNAVAILABLE");
  if (!Array.isArray(input.pendingOrders)) reservationUnknown("PENDING_ORDERS_UNAVAILABLE");
  if (input.excludeOrderId !== undefined && input.excludeOrderId !== null && !identifier(input.excludeOrderId)) reservationUnknown("EXCLUSION_ID_INVALID");
  for (const reason of input.externalUnknownReasons ?? []) reasons.add(identifier(reason) ? reason : "EXTERNAL_COVERAGE_UNKNOWN");

  const fills = Array.isArray(input.fills) ? [...input.fills] : [];
  const marks = Array.isArray(input.marks) ? [...input.marks] : [];
  const pending = Array.isArray(input.pendingOrders) ? [...input.pendingOrders] : [];
  const inventory = new Map<string, Inventory>();
  const position = (instrument: string) => {
    if (!inventory.has(instrument)) inventory.set(instrument, { quantity: 0, cost: 0, realized: 0 });
    return inventory.get(instrument)!;
  };
  const openingIds = new Set<string>();
  for (const item of input.openingInventory ?? []) {
    if (!identifier(item.instrumentId) || !positive(item.quantity) || !positive(item.referencePriceSek)
      || openingIds.has(item.instrumentId) || !finite(item.quantity * item.referencePriceSek)) {
      ledgerUnknown("OPENING_INVENTORY_INVALID"); continue;
    }
    openingIds.add(item.instrumentId);
    inventory.set(item.instrumentId, { quantity: item.quantity, cost: item.quantity * item.referencePriceSek, realized: 0 });
  }
  const seenFills = new Map<string, string>(), fillSidesAtTime = new Map<string, string>();
  for (const fill of fills) {
    if (!fill || !identifier(fill.fillId) || !identifier(fill.instrumentId)) { ledgerUnknown("FILL_IDENTITY_INVALID"); continue; }
    const hash = deterministicDigest(hashable(fill)), previous = seenFills.get(fill.fillId);
    if (previous) ledgerUnknown(`${previous === hash ? "DUPLICATE_FILL" : "CONFLICTING_FILL"}:${fill.fillId}`);
    seenFills.set(fill.fillId, hash);
    if (fill.accountId !== input.accountId) ledgerUnknown(`FILL_ACCOUNT_MISMATCH:${fill.fillId}`);
    else position(fill.instrumentId);
    if (fill.side !== "BUY" && fill.side !== "SELL") ledgerUnknown(`FILL_SIDE_INVALID:${fill.fillId}`);
    if (!positive(fill.quantity) || !positive(fill.priceSek) || !finite(fill.feeSek)) ledgerUnknown(`FILL_VALUE_UNKNOWN:${fill.fillId}`);
    if (fill.feeAsset !== "BASE" && fill.feeAsset !== "QUOTE") ledgerUnknown(`FILL_FEE_ASSET_UNKNOWN:${fill.fillId}`);
    if (fill.feeAsset === "BASE" && (!finite(fill.feeBaseQuantity) || (fill.feeBaseQuantity === 0 ? fill.feeSek !== 0 : Math.sign(fill.feeBaseQuantity) !== Math.sign(fill.feeSek ?? NaN)))) ledgerUnknown(`FILL_BASE_FEE_UNKNOWN:${fill.fillId}`);
    if (fill.feeAsset === "QUOTE" && fill.feeBaseQuantity !== null && fill.feeBaseQuantity !== 0) ledgerUnknown(`FILL_FEE_ASSET_CONFLICT:${fill.fillId}`);
    const occurred = timestamp(fill.occurredAt), available = timestamp(fill.availableAt);
    const timeKey = `${fill.instrumentId}:${occurred}`, priorSide = fillSidesAtTime.get(timeKey);
    if (priorSide && priorSide !== fill.side) ledgerUnknown(`AMBIGUOUS_FILL_ORDER:${fill.instrumentId}:${occurred}`);
    fillSidesAtTime.set(timeKey, fill.side);
    if (!Number.isFinite(occurred) || !Number.isFinite(available) || available < occurred) ledgerUnknown(`FILL_TIME_INVALID:${fill.fillId}`);
    if (occurred < baseline) ledgerUnknown(`FILL_BEFORE_BASELINE:${fill.fillId}`);
    if (occurred > economicCutoff || available > cutoff) ledgerUnknown(`FUTURE_FILL:${fill.fillId}`);
  }
  fills.sort((a, b) => timestamp(a?.occurredAt) - timestamp(b?.occurredAt) || String(a?.fillId).localeCompare(String(b?.fillId)));
  let cash = input.openingCashSek ?? 0, realized = 0, dailyRealized = 0, fees = 0, grossFees = 0, rebates = 0, dailyFees = 0;
  if (!ledgerReasons.size) for (const fill of fills) {
    const item = position(fill.instrumentId), fee = fill.feeSek!, price = fill.priceSek!;
    const gross = fill.quantity * price;
    const baseFee = fill.feeAsset === "BASE" ? fill.feeBaseQuantity! : 0;
    const cashFee = fill.feeAsset === "QUOTE" ? fee : 0;
    const inventoryQuantity = fill.side === "BUY" ? fill.quantity - baseFee : fill.quantity + baseFee;
    if (!positive(inventoryQuantity) || !finite(gross) || gross + cashFee < 0) { ledgerUnknown(`FILL_NET_VALUE_INVALID:${fill.fillId}`); break; }
    let pnl = 0;
    if (fill.side === "BUY") {
      item.quantity += inventoryQuantity;
      item.cost += gross + cashFee;
      cash -= gross + cashFee;
    } else {
      const tolerance = quantityTolerance(item.quantity, inventoryQuantity);
      if (inventoryQuantity > item.quantity + tolerance) { ledgerUnknown(`SELL_EXCEEDS_POSITION:${fill.fillId}`); break; }
      const reduction = Math.min(inventoryQuantity, item.quantity);
      const basis = item.quantity > 0 ? item.cost / item.quantity * reduction : 0;
      pnl = gross - cashFee - basis;
      item.quantity -= reduction;
      item.cost -= basis;
      if (item.quantity <= tolerance) { item.quantity = 0; item.cost = 0; }
      item.realized += pnl;
      realized += pnl;
      cash += gross - cashFee;
    }
    fees += fee; grossFees += Math.max(fee, 0); rebates += Math.max(-fee, 0);
    if (timestamp(fill.occurredAt) >= dayStart) { dailyRealized += pnl; dailyFees += fee; }
    if (![cash, item.quantity, item.cost, item.realized, realized, dailyRealized, fees, grossFees, rebates, dailyFees].every(finite)) { ledgerUnknown("LEDGER_ARITHMETIC_OVERFLOW"); break; }
    if (!input.cashReconciliation && cash < -quantityTolerance(input.openingCashSek!, gross)) { ledgerUnknown(`CASH_DEFICIT:${fill.fillId}`); break; }
  }
  // Native-currency reconciliation owns spending power; historical SEK fill
  // conversions continue to own cost basis/PnL. Funding is never trading profit.
  if (input.cashReconciliation && !ledgerReasons.size) cash = input.cashReconciliation.cashSek;

  let reservedBuy = 0;
  const reservedSell = new Map<string, number>(), seenOrders = new Map<string, string>();
  for (const order of pending) {
    if (!order || !identifier(order.orderId) || !identifier(order.instrumentId)) { reservationUnknown("ORDER_IDENTITY_INVALID"); continue; }
    const hash = deterministicDigest(hashable(order)), previous = seenOrders.get(order.orderId);
    if (previous) reservationUnknown(`${previous === hash ? "DUPLICATE_PENDING_ORDER" : "CONFLICTING_PENDING_ORDER"}:${order.orderId}`);
    seenOrders.set(order.orderId, hash);
    if (order.accountId !== input.accountId) reservationUnknown(`ORDER_ACCOUNT_MISMATCH:${order.orderId}`);
    const available = timestamp(order.availableAt);
    if (!Number.isFinite(available) || available > cutoff) reservationUnknown(`ORDER_TIME_INVALID:${order.orderId}`);
    if (order.side !== "BUY" && order.side !== "SELL") reservationUnknown(`ORDER_SIDE_INVALID:${order.orderId}`);
    if (order.side === "BUY" && (!nonNegative(order.remainingNotionalSek) || (order.remainingQuantity !== null && !nonNegative(order.remainingQuantity)))) reservationUnknown(`BUY_RESERVATION_UNKNOWN:${order.orderId}`);
    if (order.side === "SELL" && !nonNegative(order.remainingQuantity)) reservationUnknown(`SELL_RESERVATION_UNKNOWN:${order.orderId}`);
    if (order.side === "SELL" && order.remainingNotionalSek !== null && !nonNegative(order.remainingNotionalSek)) reservationUnknown(`SELL_NOTIONAL_INVALID:${order.orderId}`);
    // Validate even an excluded order; malformed/self-conflicting data cannot
    // acquire eligibility merely by excluding its own cash reservation.
    if (order.orderId === input.excludeOrderId || order.accountId !== input.accountId) continue;
    if (order.side === "BUY" && nonNegative(order.remainingNotionalSek)) reservedBuy += order.remainingNotionalSek;
    if (order.side === "SELL" && nonNegative(order.remainingQuantity)) {
      position(order.instrumentId);
      reservedSell.set(order.instrumentId, (reservedSell.get(order.instrumentId) ?? 0) + order.remainingQuantity);
    }
  }
  if (!finite(reservedBuy) || [...reservedSell.values()].some(value => !finite(value))) reservationUnknown("RESERVATION_ARITHMETIC_OVERFLOW");

  const marksByInstrument = new Map<string, LedgerMarkV2>();
  const badMarks = new Set<string>(), markIdentities = new Map<string, string>();
  for (const mark of marks) {
    if (!mark || !identifier(mark.instrumentId)) { reasons.add("MARK_IDENTITY_INVALID"); continue; }
    const observed = timestamp(mark.observedAt), available = timestamp(mark.availableAt);
    const key = `${mark.instrumentId}:${observed}`, hash = deterministicDigest(hashable(mark));
    const previous = markIdentities.get(key);
    if (previous) { reasons.add(`${previous === hash ? "DUPLICATE_MARK" : "CONFLICTING_MARK"}:${mark.instrumentId}`); badMarks.add(mark.instrumentId); }
    markIdentities.set(key, hash);
    if (!positive(mark.priceSek) || !Number.isFinite(observed) || !Number.isFinite(available) || available < observed || available > cutoff || observed > economicCutoff) {
      reasons.add(`MARK_VALUE_OR_TIME_UNKNOWN:${mark.instrumentId}`); badMarks.add(mark.instrumentId); continue;
    }
    if (!marksByInstrument.has(mark.instrumentId) || observed > timestamp(marksByInstrument.get(mark.instrumentId)!.observedAt)) marksByInstrument.set(mark.instrumentId, mark);
  }

  const ledgerKnown = !ledgerReasons.size, reservationsKnown = !reservationReasons.size;
  let exposure = 0, exposureKnown = ledgerKnown;
  const positions: AccountLedgerPositionV2[] = [...inventory].sort(([a], [b]) => a.localeCompare(b)).map(([instrumentId, item]) => {
    const mark = marksByInstrument.get(instrumentId);
    const markKnown = !!mark && !badMarks.has(instrumentId) && finite(maxMarkAge) && maxMarkAge >= 0 && economicCutoff - timestamp(mark.observedAt) <= maxMarkAge;
    const quantity = ledgerKnown ? item.quantity : null;
    const sellQuantity = reservationsKnown ? reservedSell.get(instrumentId) ?? 0 : null;
    const markPrice = markKnown ? mark!.priceSek : null;
    let marketValue = quantity === 0 ? 0 : quantity !== null && markPrice !== null ? quantity * markPrice : null;
    if (marketValue !== null && !finite(marketValue)) { marketValue = null; reasons.add(`EXPOSURE_OVERFLOW:${instrumentId}`); }
    if (quantity !== null && quantity > 0 && !markKnown) reasons.add(`${mark ? "CURRENT_MARK_UNAVAILABLE_OR_STALE" : "CURRENT_MARK_MISSING"}:${instrumentId}`);
    if (marketValue === null) exposureKnown = false; else exposure += marketValue;
    if (quantity !== null && sellQuantity !== null && sellQuantity > quantity + quantityTolerance(quantity, sellQuantity)) reasons.add(`RESERVED_SELL_EXCEEDS_POSITION:${instrumentId}`);
    return { instrumentId, quantity, costBasisSek: ledgerKnown ? item.cost : null, averageCostSek: ledgerKnown ? item.quantity > 0 ? item.cost / item.quantity : 0 : null, realizedPnlSek: ledgerKnown ? item.realized : null, markPriceSek: markPrice, marketValueSek: marketValue, reservedSellQuantity: sellQuantity, availableQuantity: quantity !== null && sellQuantity !== null ? quantity - sellQuantity : null };
  });
  if (!finite(exposure)) { exposureKnown = false; reasons.add("EXPOSURE_ARITHMETIC_OVERFLOW"); }
  const availableCash = ledgerKnown && reservationsKnown ? cash - reservedBuy : null;
  if (availableCash !== null && availableCash < -quantityTolerance(cash, reservedBuy)) reasons.add("BUY_RESERVATIONS_EXCEED_CASH");
  const inputHash = deterministicDigest(hashable({ ...input, fills: sortedInput(fills), marks: sortedInput(marks), pendingOrders: input.pendingOrders === null ? null : sortedInput(pending), markMaxAgeMs: maxMarkAge, excludeOrderId: input.excludeOrderId ?? null }));
  const body: Omit<AccountLedgerSnapshotV2, "snapshotKey" | "resultHash"> = {
    ...(input.openingInventory ? { pnlScope: "SINCE_OBSERVED_BASELINE_NOT_HISTORICAL_COST" as const } : {}),
    ...(input.demoReconciliation ? { demoReconciliation: input.demoReconciliation } : {}),
    version: ACCOUNT_LEDGER_V2_VERSION, accountId: input.accountId, baselineAt: input.baselineAt,
    cutoffAt: input.cutoffAt, economicCutoffAt, dailyWindowStartAt: input.dailyWindowStartAt,
    status: reasons.size ? "UNKNOWN" as const : "KNOWN" as const,
    cashSek: ledgerKnown ? cash : null, realizedPnlSek: ledgerKnown ? realized : null,
    dailyRealizedPnlSek: ledgerKnown ? dailyRealized : null, feesSek: ledgerKnown ? fees : null,
    grossFeesSek: ledgerKnown ? grossFees : null, rebatesSek: ledgerKnown ? rebates : null,
    dailyFeesSek: ledgerKnown ? dailyFees : null, positions,
    grossExposureSek: exposureKnown ? exposure : null, reservedBuySek: reservationsKnown ? reservedBuy : null,
    availableCashSek: availableCash, openPositions: ledgerKnown ? positions.filter(item => item.quantity! > 0).length : null,
    excludedOrderId: input.excludeOrderId ?? null,
    pendingOrders: Array.isArray(input.pendingOrders) ? [...pending].sort((a, b) => String(a?.orderId).localeCompare(String(b?.orderId)) || deterministicDigest(hashable(a)).localeCompare(deterministicDigest(hashable(b)))) : null,
    unknownReasons: [...reasons].sort(), inputHash,
  };
  const resultHash = deterministicDigest(body);
  return { ...body, snapshotKey: `account_v2_${resultHash.slice(0, 40)}`, resultHash };
}

export function riskContextFromAccountLedgerV2(snapshot: AccountLedgerSnapshotV2, excludeOrderId: string | null = snapshot.excludedOrderId) {
  const unknown = () => ({ status: "UNKNOWN" as const, openPositions: null, dailyLossSek: null, totalExposureSek: null, availableCashSek: null, availableSellQuantity: null });
  if (!verifyAccountLedgerV2Snapshot(snapshot)) return unknown();
  // These two reservation errors may resolve when this very order is excluded.
  // Missing marks/history/fees/provider coverage can never be bypassed this way.
  const hardReasons = snapshot.unknownReasons.filter(reason => reason !== "BUY_RESERVATIONS_EXCEED_CASH" && !reason.startsWith("RESERVED_SELL_EXCEEDS_POSITION:"));
  if (hardReasons.length || (snapshot.status !== "KNOWN" && snapshot.unknownReasons.length === 0) || !finite(snapshot.dailyRealizedPnlSek) || !nonNegative(snapshot.grossExposureSek) || !finite(snapshot.cashSek) || !nonNegative(snapshot.openPositions) || !Array.isArray(snapshot.pendingOrders)) return unknown();
  let reservedBuy = 0;
  const reservedSell = new Map<string, number>();
  for (const order of snapshot.pendingOrders) {
    if (order.orderId === excludeOrderId) continue;
    if (order.side === "BUY") { if (!nonNegative(order.remainingNotionalSek)) return unknown(); reservedBuy += order.remainingNotionalSek; }
    else { if (!nonNegative(order.remainingQuantity)) return unknown(); reservedSell.set(order.instrumentId, (reservedSell.get(order.instrumentId) ?? 0) + order.remainingQuantity); }
  }
  const availableCash = snapshot.cashSek - reservedBuy;
  if (!finite(availableCash) || availableCash < -quantityTolerance(snapshot.cashSek, reservedBuy)) return unknown();
  const availableSellQuantity: Record<string, number> = Object.create(null);
  for (const item of snapshot.positions) {
    if (item.quantity === null) return unknown();
    const reserved = reservedSell.get(item.instrumentId) ?? 0;
    if (reserved > item.quantity + quantityTolerance(reserved, item.quantity)) return unknown();
    availableSellQuantity[item.instrumentId] = Math.max(0, item.quantity - reserved);
  }
  for (const [instrument, reserved] of reservedSell) if (!(instrument in availableSellQuantity) && reserved > 0) return unknown();
  const totalExposure = snapshot.grossExposureSek + reservedBuy;
  if (!finite(totalExposure)) return unknown();
  return { status: "KNOWN" as const, openPositions: snapshot.openPositions, dailyLossSek: Math.max(0, -snapshot.dailyRealizedPnlSek), totalExposureSek: totalExposure, availableCashSek: availableCash, availableSellQuantity };
}

/** Stored payload integrity check, not a substitute for database authorization. */
export function verifyAccountLedgerV2Snapshot(value: unknown): value is AccountLedgerSnapshotV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as AccountLedgerSnapshotV2;
  try {
    if (item.version !== ACCOUNT_LEDGER_V2_VERSION || !identifier(item.accountId) || !["KNOWN", "UNKNOWN"].includes(item.status)
      || !Array.isArray(item.unknownReasons) || item.unknownReasons.some(reason => typeof reason !== "string")
      || !Array.isArray(item.positions) || (item.pendingOrders !== null && !Array.isArray(item.pendingOrders))
      || typeof item.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(item.inputHash)
      || typeof item.resultHash !== "string" || !/^[a-f0-9]{64}$/.test(item.resultHash)
      || item.snapshotKey !== `account_v2_${item.resultHash.slice(0, 40)}`) return false;
    if ([item.cashSek, item.realizedPnlSek, item.dailyRealizedPnlSek, item.feesSek, item.grossFeesSek, item.rebatesSek, item.dailyFeesSek, item.grossExposureSek, item.reservedBuySek, item.availableCashSek, item.openPositions].some(value => value !== null && !finite(value))) return false;
    if (item.positions.some(position => !position || !identifier(position.instrumentId) || [position.quantity, position.costBasisSek, position.averageCostSek, position.realizedPnlSek, position.markPriceSek, position.marketValueSek, position.reservedSellQuantity, position.availableQuantity].some(value => value !== null && !finite(value)))) return false;
    const { snapshotKey: _key, resultHash, ...body } = item;
    return deterministicDigest(body) === resultHash;
  } catch { return false; }
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function positive(value: unknown): value is number { return finite(value) && value > 0; }
function nonNegative(value: unknown): value is number { return finite(value) && value >= 0; }
function identifier(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value === value.trim(); }
function timestamp(value: unknown) { return typeof value === "string" ? Date.parse(value) : NaN; }
function quantityTolerance(a: number, b: number) { return Number.EPSILON * 8 * Math.max(Math.abs(a), Math.abs(b)); }
function sortedInput(values: unknown[]) { return values.map(value => ({ value, hash: deterministicDigest(hashable(value)) })).sort((a, b) => a.hash.localeCompare(b.hash)).map(item => item.value); }
function hashable(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return { invalidNumber: String(value) };
  if (value === undefined) return { missingValue: true };
  if (Array.isArray(value)) return value.map(hashable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hashable(item)]));
  return value;
}
