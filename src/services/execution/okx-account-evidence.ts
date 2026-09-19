import { deterministicDigest } from "@/domain/events";
import type { DemoAccountEvidence } from "./account-evidence";

type Row = Record<string, unknown>;
type Read = (path: string) => Promise<unknown[]>;
const fail = (reason: string): never => { throw new Error(`DEMO_RECONCILIATION:${reason}`); };
const text = (value: unknown) => typeof value === "string" ? value : fail("INVALID_TEXT");
const id = (value: unknown) => /^[1-9][0-9]{0,39}$/.test(text(value)) ? value as string : fail("INVALID_ID");
const number = (value: unknown) => typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : fail("INVALID_AMOUNT");
const nonnegative = (value: unknown) => { const n = number(value); return n >= 0 ? n : fail("NEGATIVE_AMOUNT"); };
const time = (value: unknown) => { const n = Number(id(value)); return Number.isSafeInteger(n) && n <= Date.now() ? new Date(n).toISOString() : fail("INVALID_TIME"); };
const rows = (input: unknown[]) => { if (!Array.isArray(input) || input.some(x => !x || typeof x !== "object" || Array.isArray(x))) fail("INVALID_RESPONSE"); return input as Row[]; };
const only = (input: unknown[]) => { const result = rows(input); return result.length === 1 ? result[0] : fail("EXPECTED_ONE_RECORD"); };

/** Account-wide balances, with one explicitly selected execution market. */
export async function readOkxAccountEvidence(read: Read, instrumentId: string, windowStart: string): Promise<DemoAccountEvidence> {
  if (!/^[A-Z0-9]{1,20}-[A-Z0-9]{1,20}$/.test(instrumentId)) fail("INVALID_INSTRUMENT");
  const startedAt = new Date().toISOString(), start = Date.parse(windowStart);
  // Deliberately narrower than provider retention, including month-end variation.
  if (!Number.isFinite(start) || start > Date.now() || start < Date.now() - 80 * 86400_000) fail("BASELINE_OUTSIDE_RETENTION");
  const config = async () => {
    const row = only(await read("/api/v5/account/config"));
    if (row.acctLv !== "1" || row.autoLoan === true || row.autoLoan === "true") fail("SPOT_ACCOUNT_REQUIRED");
    return id(row.uid);
  };
  const externalAccountId = await config();
  const instruments = await read(`/api/v5/account/instruments?instType=SPOT&instId=${encodeURIComponent(instrumentId)}`);
  if (!Array.isArray(instruments) || instruments.length !== 1) fail("INSTRUMENT_NOT_AVAILABLE_FOR_ACCOUNT");
  const instrument = only(instruments);
  const baseCurrency = text(instrument.baseCcy), quoteCurrency = text(instrument.quoteCcy);
  if (instrument.instId !== instrumentId || instrument.instType !== "SPOT" || instrument.state !== "live"
    || instrumentId !== `${baseCurrency}-${quoteCurrency}` || baseCurrency === quoteCurrency) fail("INSTRUMENT_METADATA_MISMATCH");
  const fees = only(await read(`/api/v5/account/trade-fee?instType=SPOT&instId=${encodeURIComponent(instrumentId)}`));
  const feeGroups = Array.isArray(fees.feeGroup) ? rows(fees.feeGroup) : [];
  const group = feeGroups.filter(x => x.groupId === instrument.groupId);
  if (typeof instrument.groupId !== "string" || group.length !== 1 || fees.instType !== "SPOT") fail("INSTRUMENT_FEE_GROUP_UNKNOWN");
  const feeRate = Math.max(0, -number(group[0].maker), -number(group[0].taker));
  if (feeRate > 0.01) fail("FEE_RATE_OUTSIDE_PILOT_LIMIT");
  async function balances() {
    const row = only(await read("/api/v5/account/balance"));
    if (!Array.isArray(row.details)) fail("BALANCES_MISSING");
    const result = rows(row.details as unknown[]).map(item => {
      const currency = text(item.ccy), total = nonnegative(item.cashBal), available = nonnegative(item.availBal);
      // OKX leaves margin-only liability fields empty in spot account mode.
      if (!/^[A-Z0-9]{1,20}$/.test(currency) || available > total + 1e-10 || (item.liab !== undefined && item.liab !== "" && number(item.liab) !== 0)) fail("INVALID_BALANCE");
      return { currency, total, available };
    }).sort((a, b) => a.currency.localeCompare(b.currency));
    if (new Set(result.map(x => x.currency)).size !== result.length) fail("DUPLICATE_BALANCE");
    return result;
  }
  async function pages(path: string, key: string) {
    const result: Row[] = [], seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data = rows(await read(`${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&after=${cursor}` : ""}`));
      if (data.length > 100) fail("PAGE_SIZE_INVALID");
      for (const row of data) {
        const next = id(row[key]);
        if (seen.has(next) || (cursor && BigInt(next) >= BigInt(cursor))) fail("PAGINATION_CONFLICT");
        seen.add(next); cursor = next; result.push(row);
      }
      if (data.length < 100) return result;
      await new Promise(resolve => setTimeout(resolve, 420));
    }
    return fail("READ_BUDGET_EXCEEDED");
  }
  async function orders() {
    // No instType filter: unsupported manual orders must not disappear.
    const data = await pages("/api/v5/trade/orders-pending", "ordId");
    return data.map(row => {
      if (row.instType !== "SPOT" || row.instId !== instrumentId || row.tdMode !== "cash"
        || row.ordType !== "limit" || !["live", "partially_filled"].includes(text(row.state))
        || !["buy", "sell"].includes(text(row.side)) || row.tradeQuoteCcy !== quoteCurrency) fail("UNSUPPORTED_PENDING_ORDER");
      const quantity = nonnegative(row.sz), filled = nonnegative(row.accFillSz), price = nonnegative(row.px);
      if (quantity <= 0 || filled >= quantity || price <= 0) fail("INVALID_PENDING_ORDER");
      return { id: id(row.ordId), instrumentId, side: row.side === "buy" ? "BUY" as const : "SELL" as const, quantity, filled, price, updatedAt: time(row.uTime) };
    });
  }
  const before = await balances(), pending = await orders();
  // Stop orders can reserve/fill later and are not part of orders-pending.
  for (const ordType of ["conditional", "oco", "trigger", "move_order_stop", "iceberg", "twap"]) {
    if (rows(await read(`/api/v5/trade/orders-algo-pending?ordType=${ordType}&limit=1`)).length) fail("ALGO_ORDERS_UNSUPPORTED");
  }
  const billPath = `/api/v5/account/bills-archive?begin=${start}`;
  const rawBills = await pages(billPath, "billId");
  const bills = rawBills.map(row => {
    const occurredAt = time(row.ts), currency = text(row.ccy);
    if (Date.parse(occurredAt) <= start || ![baseCurrency, quoteCurrency].includes(currency)) fail("BILL_SCOPE_MISMATCH");
    if (!["1", "2"].includes(text(row.type))) fail("UNSUPPORTED_ACCOUNT_MOVEMENT");
    if (row.type === "2" && (row.instId !== instrumentId || row.instType !== "SPOT")) fail("UNSUPPORTED_TRADE");
    if (row.type === "1" && currency !== quoteCurrency) fail("NON_CASH_TRANSFER_UNSUPPORTED");
    return { id: id(row.billId), currency, change: number(row.balChg), balance: nonnegative(row.bal), type: text(row.type), orderId: row.type === "2" ? id(row.ordId) : "", occurredAt };
  });
  const ticker = only(await read(`/api/v5/market/ticker?instId=${encodeURIComponent(instrumentId)}`));
  const mark = { price: nonnegative(ticker.bidPx), observedAt: time(ticker.ts) };
  if (ticker.instId !== instrumentId || mark.price <= 0 || Date.now() - Date.parse(mark.observedAt) > 60_000) fail("MARK_UNAVAILABLE_OR_STALE");
  const executionMarket = { baseCurrency, quoteCurrency, bid: mark.price, ask: nonnegative(ticker.askPx), observedAt: mark.observedAt,
    lotSize: nonnegative(instrument.lotSz), minimumSize: nonnegative(instrument.minSz), tickSize: nonnegative(instrument.tickSz) };
  if (executionMarket.ask < executionMarket.bid || [executionMarket.lotSize,executionMarket.minimumSize,executionMarket.tickSize].some(x=>x<=0)) fail("EXECUTION_MARKET_RULES_INVALID");
  const holdingMarks: NonNullable<DemoAccountEvidence["holdingMarks"]> = [];
  for (const balance of before.filter(x => x.total > 0 && ![baseCurrency, quoteCurrency, "USD", "EUR", "SEK"].includes(x.currency))) {
    const marketId = `${balance.currency}-${quoteCurrency}`;
    const metadata = only(await read(`/api/v5/account/instruments?instType=SPOT&instId=${encodeURIComponent(marketId)}`));
    if (metadata.instId !== marketId || metadata.instType !== "SPOT" || metadata.state !== "live"
      || metadata.baseCcy !== balance.currency || metadata.quoteCcy !== quoteCurrency) fail("HOLDING_MARKET_UNAVAILABLE");
    const price = only(await read(`/api/v5/market/ticker?instId=${encodeURIComponent(marketId)}`));
    const observedAt = time(price.ts), bid = nonnegative(price.bidPx);
    if (price.instId !== marketId || bid <= 0 || Date.now() - Date.parse(observedAt) > 60_000) fail("HOLDING_MARK_UNAVAILABLE_OR_STALE");
    holdingMarks.push({ currency: balance.currency, instrumentId: marketId, quoteCurrency, price: bid, observedAt });
  }
  const after = await balances(), pendingAfter = await orders();
  const latest = rows(await read(`${billPath}&limit=1`));
  if ((latest[0]?.billId ?? null) !== (rawBills[0]?.billId ?? null)
    || deterministicDigest(before) !== deterministicDigest(after) || deterministicDigest(pending) !== deterministicDigest(pendingAfter)
    || externalAccountId !== await config()) fail("ACCOUNT_CHANGED_DURING_CAPTURE");
  if (Date.now() - Date.parse(startedAt) > 60_000) fail("CAPTURE_TOO_SLOW");
  return { version: "demo-account-evidence-v1", externalAccountId, instrumentId, baseCurrency, quoteCurrency,
    startedAt, observedAt: new Date().toISOString(), balances: after, orders: pending, bills, mark, holdingMarks, executionMarket, feeRate, windowStart, complete: true };
}
