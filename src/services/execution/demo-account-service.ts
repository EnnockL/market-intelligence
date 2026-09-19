import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { rebuildAccountLedgerV2, type AccountLedgerSnapshotV2, type PendingOrderV2 } from "@/domain/account-ledger-v2";
import { createDemoBaseline, reconcileDemoAccount } from "@/domain/demo-account-reconciliation";
import { readBoundedPages } from "@/repositories/bounded-read";
import type { DemoAccountBaseline, DemoAccountEvidence } from "./account-evidence";
import type { ExecutionProvider } from "./provider";
import { ExecutionFillSyncService } from "./fill-sync-service";
import { finiteNumber, historicalSekRate, normalizeLedgerFill, remainingOrderReservation } from "./ledger-evidence";

export class DemoAccountService {
  constructor(private db: SupabaseClient, private provider: ExecutionProvider) {}

  /** Explicit operator preparation. Never changes trading mode or enables orders. */
  async prepareBaseline(instrumentId: string) {
    if (this.provider.mode !== "DEMO" || !this.provider.getAccountEvidence) throw new Error("DEMO_EVIDENCE_PROVIDER_REQUIRED");
    const evidence = await this.provider.getAccountEvidence(instrumentId, new Date().toISOString());
    const baseline = createDemoBaseline(evidence, true);
    const result = await this.db.rpc("prepare_demo_account_baseline", { p_provider: this.provider.name, p_baseline: baseline, p_evidence: evidence });
    if (result.error) throw result.error;
    return result.data;
  }

  async capture(account: Record<string, any>) {
    const baseline = account.demo_baseline as DemoAccountBaseline;
    let evidence: DemoAccountEvidence | null = null, snapshot: AccountLedgerSnapshotV2;
    let rates: any[] = [], fills: any[] = [], errorReason: string | null = null;
    try {
      if (!this.provider.getAccountEvidence || this.provider.mode !== "DEMO" || baseline.externalAccountId !== account.provider_account_id) throw new Error("DEMO_ACCOUNT_BINDING_INVALID");
      const health = await this.provider.health();
      if (health.externalAccountId !== baseline.externalAccountId) throw new Error("DEMO_ACCOUNT_IDENTITY_CHANGED");
      const sync = await new ExecutionFillSyncService(this.db, this.provider).syncAccount({ accountId: account.id, windowStart: baseline.at, windowEnd: new Date().toISOString(), maxPages: 10, pageSize: 100 });
      if (sync.status !== "COMPLETE_WINDOW") throw new Error(`DEMO_FILL_HISTORY_${sync.status}`);
      evidence = await this.provider.getAccountEvidence(baseline.instrumentId, baseline.at);
      const cutoffAt = new Date().toISOString();
      fills = await readBoundedPages<any>("demo_reconciliation_fills", (from, to) => this.db.from("execution_fills").select("*")
        .eq("account_id", account.id).eq("provider", this.provider.name).eq("provider_environment", "DEMO").eq("provenance_status", "VERIFIED_PROVIDER")
        .gte("occurred_at", baseline.at).lte("occurred_at", evidence!.observedAt).lte("available_at", cutoffAt).order("occurred_at").order("id").range(from, to));
      const reconciled = reconcileDemoAccount(baseline, evidence, fills.map(row => ({ ...row,
        quantity: finiteNumber(row.quantity) ?? NaN, price: finiteNumber(row.price) ?? NaN, fee_amount: finiteNumber(row.fee_amount) ?? NaN })));
      rates = await readBoundedPages<any>("demo_reconciliation_fx", (from, to) => this.db.from("fx_observations").select("*")
        .eq("quote_currency", "SEK").lte("available_at", cutoffAt)
        .gte("effective_at", new Date(Date.parse(baseline.at) - 7 * 86400_000).toISOString()).lte("effective_at", evidence!.observedAt)
        .order("effective_at").order("id").range(from, to));
      const fx = historicalSekRate(baseline.quoteCurrency, evidence.observedAt, cutoffAt, rates);
      const openingFx = historicalSekRate(baseline.quoteCurrency, baseline.at, cutoffAt, rates);
      if (!fx || !openingFx) throw new Error("DEMO_DIRECT_QUOTE_SEK_FX_REQUIRED");
      const openingInventory = baseline.openingBalances ? baseline.openingBalances.filter(x => x.total > 0 && x.currency !== baseline.quoteCurrency).map(balance => {
        const valuation = holdingValuation(balance.currency, baseline, baseline.openingMarks ?? [], baseline.openingMark,
          baseline.at, cutoffAt, openingFx.rate, rates);
        return { instrumentId: valuation.instrumentId, quantity: balance.total, referencePriceSek: valuation.priceSek };
      }) : undefined;
      const holdingMarks = evidence.balances.filter(x => x.total > 0 && ![baseline.baseCurrency, baseline.quoteCurrency].includes(x.currency)).map(balance =>
        holdingValuation(balance.currency, baseline, evidence!.holdingMarks ?? [], evidence!.mark, evidence!.observedAt, cutoffAt, fx.rate, rates));
      const orders = await readBoundedPages<any>("demo_reconciliation_orders", (from, to) => this.db.from("execution_orders").select("*,execution_intents!inner(*)")
        .eq("account_id", account.id).eq("provider", this.provider.name).eq("provider_environment", "DEMO").order("id").range(from, to));
      const pending: PendingOrderV2[] = [];
      for (const order of evidence.orders) {
        const matches = orders.filter(local => local.provider_order_id === order.id);
        if (matches.length > 1) throw new Error("DEMO_DUPLICATE_ORDER_MAPPING");
        const local = matches[0], intent = local ? (Array.isArray(local.execution_intents) ? local.execution_intents[0] : local.execution_intents) : null;
        if (local && (intent?.instrument_id !== order.instrumentId || intent?.side !== order.side || Number(local.filled_quantity) !== order.filled
          || Number(intent?.quantity) !== order.quantity)) throw new Error("DEMO_ORDER_OBSERVATION_MISMATCH");
        pending.push({ orderId: local?.id ?? `external:${order.id}`, accountId: account.id, instrumentId: order.instrumentId, side: order.side,
          remainingQuantity: order.quantity - order.filled,
          remainingNotionalSek: (order.quantity - order.filled) * order.price * fx.rate * (1 + evidence.feeRate), availableAt: cutoffAt });
      }
      for (const local of orders) {
        if (["SUBMITTING", "RECONCILIATION_REQUIRED"].includes(local.current_state)) throw new Error("DEMO_LOCAL_ORDER_UNCERTAIN");
        if (["SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED"].includes(local.current_state) && !evidence.orders.some(x => x.id === local.provider_order_id)) throw new Error("DEMO_LOCAL_ORDER_NOT_RECONCILED");
        if (local.current_state === "SAFETY_PASSED") pending.push(remainingOrderReservation(local));
      }
      const normalized = fills.map(row => normalizeLedgerFill(row, cutoffAt, rates));
      snapshot = rebuildAccountLedgerV2({ accountId: account.id, baselineAt: baseline.at, openingCashSek: baseline.cash * openingFx.rate, openingCashStatus: "DECLARED",
        historyComplete: true, cutoffAt, economicCutoffAt: evidence.observedAt, dailyWindowStartAt: `${evidence.observedAt.slice(0, 10)}T00:00:00.000Z`,
        fills: normalized.map(x => x.fill), pendingOrders: pending, openingInventory,
        marks: [{ instrumentId: baseline.instrumentId, priceSek: evidence.mark.price * fx.rate, observedAt: evidence.mark.observedAt, availableAt: cutoffAt }, ...holdingMarks],
        cashReconciliation: { cashSek: reconciled.cash * fx.rate, evidenceHash: reconciled.evidenceHash },
        demoReconciliation: { externalAccountId: evidence.externalAccountId, instrumentId: evidence.instrumentId, quoteCurrency: evidence.quoteCurrency,
          ...(evidence.executionMarket ? { market: evidence.executionMarket } : {}), quoteSekRate: fx.rate, feeRate: evidence.feeRate, evidenceHash: reconciled.evidenceHash } });
    } catch (error) {
      // Publish UNKNOWN so a previous KNOWN capture cannot mask a new failure.
      const message = error instanceof Error ? error.message : "DEMO_CAPTURE_FAILED";
      errorReason = /^(DEMO_[A-Z_:]+|DEMO_RECONCILIATION:[A-Z_]+)$/.test(message) ? message : "DEMO_CAPTURE_FAILED";
      const now = new Date().toISOString();
      snapshot = rebuildAccountLedgerV2({ accountId: account.id, baselineAt: baseline.at, openingCashSek: null, openingCashStatus: "UNKNOWN", historyComplete: false,
        cutoffAt: now, dailyWindowStartAt: `${now.slice(0, 10)}T00:00:00.000Z`, fills: [], marks: [], pendingOrders: null, externalUnknownReasons: [errorReason] });
    }
    const record = { evidence, errorReason, fxReferences: rates.map(row => row.id), baselineHash: deterministicDigest(baseline) };
    const published = await this.db.rpc("publish_demo_account_capture", { p_account_id: account.id, p_revision: account.revision,
      p_record: record, p_snapshot: snapshot, p_fill_ids: fills.map(row => row.id) });
    if (published.error) throw published.error;
    return { accountKey: account.account_key, providerStatus: evidence && !errorReason ? "KNOWN" : "UNKNOWN", riskStatus: snapshot.status,
      cashSek: snapshot.cashSek, openPositions: snapshot.openPositions, reservedExposureSek: snapshot.reservedBuySek, unknownReasons: snapshot.unknownReasons, fillSync: null };
  }
}

function holdingValuation(currency: string, baseline: DemoAccountBaseline, marks: NonNullable<DemoAccountEvidence["holdingMarks"]>,
  main: DemoAccountEvidence["mark"] | undefined, at: string, cutoffAt: string, quoteRate: number, rates: any[]) {
  if (["USD", "EUR", "SEK"].includes(currency) && currency !== baseline.baseCurrency) {
    const fx = historicalSekRate(currency, at, cutoffAt, rates);
    if (!fx) throw new Error("DEMO_HOLDING_FIAT_FX_REQUIRED");
    // Passive foreign cash is valued as exposure, never added to spendable quote cash.
    return { instrumentId: `FX:${currency}`, priceSek: fx.rate, observedAt: at, availableAt: cutoffAt };
  }
  const mark = currency === baseline.baseCurrency ? main : marks.find(x => x.currency === currency && x.quoteCurrency === baseline.quoteCurrency && x.instrumentId === `${currency}-${baseline.quoteCurrency}`);
  // Opening marks were read after the quiet baseline began, within the same bounded capture.
  if (!mark || !Number.isFinite(mark.price) || mark.price <= 0 || !Number.isFinite(Date.parse(mark.observedAt))
    || Math.abs(Date.parse(at) - Date.parse(mark.observedAt)) > 60_000) throw new Error("DEMO_HOLDING_MARK_REQUIRED");
  return { instrumentId: `${currency}-${baseline.quoteCurrency}`, priceSek: mark.price * quoteRate, observedAt: mark.observedAt, availableAt: cutoffAt };
}
