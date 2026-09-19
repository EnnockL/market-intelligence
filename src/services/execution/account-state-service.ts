import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { rebuildAccountLedgerV2 } from "@/domain/account-ledger-v2";
import { readBoundedPages } from "@/repositories/bounded-read";
import type { ExecutionProvider } from "./provider";
import { ExecutionFillSyncService } from "./fill-sync-service";
import { DemoAccountService } from "./demo-account-service";
import { finiteNumber, normalizeLedgerFill, remainingOrderReservation } from "./ledger-evidence";

const pendingStates = ["SAFETY_PASSED", "SUBMITTING", "SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED", "RECONCILIATION_REQUIRED"];

export class AccountStateService {
  constructor(private db: SupabaseClient, private provider: ExecutionProvider) {}

  async capture(requestedCutoffAt?: string) {
    const accountKey = this.provider.mode === "SHADOW" ? "shadow-primary" : `${this.provider.name}-primary`;
    const inserted = await this.db.from("execution_accounts").upsert({ account_key: accountKey, provider: this.provider.name, provider_environment: this.provider.mode, status: "ACTIVE" }, { onConflict: "account_key", ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    const accountRow = await this.db.from("execution_accounts").select("*").eq("account_key", accountKey).single();
    if (accountRow.error) throw accountRow.error;
    const account = accountRow.data, reasons: string[] = [];
    const baselineAt = account.ledger_baseline_at ?? null;
    if (account.provider !== this.provider.name || account.provider_environment !== this.provider.mode) throw new Error("ACCOUNT_PROVIDER_MISMATCH");
    if (!requestedCutoffAt && this.provider.mode === "DEMO" && account.demo_baseline) return new DemoAccountService(this.db, this.provider).capture(account);
    const fillCoverage = async (cutoff: string) => {
      if (!baselineAt) return null;
      const result = await this.db.rpc("execution_fill_coverage_v1", { p_account_id: account.id, p_provider: this.provider.name, p_environment: this.provider.mode, p_baseline_at: baselineAt, p_cutoff_at: cutoff });
      if (result.error) throw result.error;
      const value = result.data;
      if (!value?.through) return null;
      const through = Date.parse(value.through);
      if (!Number.isFinite(through) || through < Date.parse(baselineAt) || through > Date.parse(cutoff) || !Number.isSafeInteger(value.checkpointCount) || value.checkpointCount < 1 || typeof value.checkpointHash !== "string") throw new Error("FILL_COVERAGE_SUMMARY_INVALID");
      return value as { through: string; checkpointCount: number; checkpointHash: string };
    };
    let sync: Awaited<ReturnType<ExecutionFillSyncService["syncAccount"]>> | null = null;
    // Historical reads must never import data and pretend it was known earlier.
    if (!requestedCutoffAt && baselineAt && this.provider.getFillsPage) {
      const syncUntil = new Date().toISOString(), coverage = await fillCoverage(syncUntil);
      const resume = await this.db.from("execution_fill_sync_states").select("requested_start_at,requested_end_at")
        .eq("account_id", account.id).eq("provider", this.provider.name).eq("provider_environment", this.provider.mode)
        .in("status", ["PARTIAL", "FAILED"]).gte("requested_start_at", baselineAt).lte("observed_at", syncUntil)
        .order("requested_start_at").order("id").limit(1).maybeSingle();
      if (resume.error) throw resume.error;
      const unfinished = resume.data;
      const windowStart = unfinished?.requested_start_at ?? coverage?.through ?? baselineAt;
      const windowEnd = unfinished?.requested_end_at ?? syncUntil;
      if (Date.parse(windowStart) < Date.parse(windowEnd)) sync = await new ExecutionFillSyncService(this.db, this.provider).syncAccount({ accountId: account.id, windowStart, windowEnd, maxPages: 3, pageSize: 100 });
    }
    const providerState = await this.provider.getAccountState();
    const observationAvailableAt = new Date().toISOString(), payloadHash = deterministicDigest(providerState);
    const observationKey = deterministicDigest({ accountId: account.id, provider: this.provider.name, payloadHash, observedAt: providerState.observedAt });
    const observation = await this.db.from("account_state_observations").upsert({
      observation_key: observationKey, account_id: account.id, provider: this.provider.name, provider_environment: this.provider.mode,
      balances: providerState.balances, positions: providerState.positions, total_equity_usd: providerState.totalEquityUsd,
      available_quote_usd: providerState.availableQuoteUsd, data_status: providerState.status, unknown_reasons: providerState.unknownReasons,
      observed_at: providerState.observedAt, available_at: observationAvailableAt, source_reference: providerState.sourceReference, payload_hash: payloadHash,
    }, { onConflict: "observation_key", ignoreDuplicates: true });
    if (observation.error) throw observation.error;
    const cutoffAt = requestedCutoffAt ?? new Date().toISOString();
    const coverage = await fillCoverage(cutoffAt), economicCutoffAt = coverage?.through ?? cutoffAt;
    const dayStart = new Date(economicCutoffAt); dayStart.setUTCHours(0, 0, 0, 0);
    if (sync && sync.status !== "COMPLETE_WINDOW") reasons.push(`FILL_SYNC_${sync.status}`);
    if (!this.provider.getFillsPage) reasons.push("PROVIDER_FILL_HISTORY_UNSUPPORTED");
    if (!account.ledger_history_reference || Date.parse(account.ledger_history_verified_through ?? "") < Date.parse(economicCutoffAt)
      || !Number.isFinite(Date.parse(account.ledger_history_verified_through ?? ""))) reasons.push("FUNDING_AND_OPENING_INVENTORY_COVERAGE_UNKNOWN");
    if (requestedCutoffAt) reasons.push("HISTORICAL_PENDING_ORDER_SNAPSHOT_UNAVAILABLE");
    if (Date.parse(providerState.observedAt) > Date.parse(cutoffAt) || Date.parse(observationAvailableAt) > Date.parse(cutoffAt)) reasons.push("ACCOUNT_OBSERVATION_AFTER_CUTOFF");
    if (providerState.status !== "KNOWN") reasons.push("PROVIDER_ACCOUNT_STATE_UNKNOWN");
    if (this.provider.mode === "DEMO") reasons.push("PROVIDER_OPEN_ORDERS_COVERAGE_UNKNOWN");
    // A converted starting stablecoin balance is not a declared SEK cash ledger.
    if (providerState.balances.some(row => row.currency !== "SEK" && row.total !== 0)) reasons.push("MULTI_CURRENCY_CASH_RECONCILIATION_REQUIRED");
    if (providerState.positions.some(row => row.quantity !== 0)) reasons.push("EXTERNAL_POSITION_RECONCILIATION_REQUIRED");

    const fills = baselineAt ? await readBoundedPages<any>("execution_account_fills", (from, to) => this.db.from("execution_fills").select("*")
      .eq("account_id", account.id).eq("provider", this.provider.name).eq("provider_environment", this.provider.mode).eq("provenance_status", "VERIFIED_PROVIDER")
      .gte("occurred_at", baselineAt).lte("occurred_at", economicCutoffAt).lte("available_at", cutoffAt).order("occurred_at").order("id").range(from, to)) : [];
    const orders = await readBoundedPages<any>("execution_account_orders", (from, to) => this.db.from("execution_orders").select("*,execution_intents!inner(instrument_id,side,quantity,quote_amount_sek)")
      .eq("provider", this.provider.name).eq("provider_environment", this.provider.mode).order("id").range(from, to));
    if (orders.some(row => row.account_id == null && (pendingStates.includes(row.current_state) || Number(row.filled_quantity) > 0))) reasons.push("LEGACY_ORDER_ACCOUNT_UNKNOWN");
    const ownOrders = orders.filter(row => row.account_id === account.id), fillsByOrder = new Map<string, number>();
    // Immutable EXTERNAL_ORDER fills can precede a local mapping. Match their
    // exact account-scoped provider order + instrument identity, never a ticker.
    for (const fill of fills) {
      const key = JSON.stringify([fill.provider_order_id, fill.instrument_id]);
      fillsByOrder.set(key, (fillsByOrder.get(key) ?? 0) + Number(fill.quantity));
    }
    for (const order of ownOrders) {
      const intent = Array.isArray(order.execution_intents) ? order.execution_intents[0] : order.execution_intents;
      const expected = finiteNumber(order.filled_quantity), actual = fillsByOrder.get(JSON.stringify([order.provider_order_id, intent?.instrument_id])) ?? 0;
      if (expected === null || Math.abs(expected - actual) > Number.EPSILON * 16 * Math.max(Math.abs(expected), Math.abs(actual))) reasons.push(`ORDER_FILL_RECONCILIATION_REQUIRED:${order.id}`);
      if (["SUBMITTING", "RECONCILIATION_REQUIRED"].includes(order.current_state)) reasons.push(`ORDER_STATE_UNCERTAIN:${order.id}`);
    }
    const rates = fills.length ? await readBoundedPages<any>("execution_historical_fx", (from, to) => this.db.from("fx_observations").select("*")
      .eq("quote_currency", "SEK").lte("available_at", cutoffAt).lte("effective_at", economicCutoffAt)
      .gte("effective_at", new Date(Date.parse(baselineAt) - 7 * 86400_000).toISOString()).order("effective_at").order("id").range(from, to)) : [];
    const normalized = fills.map(row => normalizeLedgerFill(row, cutoffAt, rates));
    const snapshot = rebuildAccountLedgerV2({ accountId: account.id, baselineAt,
      openingCashSek: finiteNumber(account.initial_cash_sek), openingCashStatus: account.ledger_opening_status === "DECLARED" ? "DECLARED" : "UNKNOWN",
      historyComplete: coverage !== null, cutoffAt, economicCutoffAt, dailyWindowStartAt: dayStart.toISOString(),
      fills: normalized.map(row => row.fill), marks: [],
      pendingOrders: ownOrders.filter(row => pendingStates.includes(row.current_state)).map(remainingOrderReservation), externalUnknownReasons: reasons,
    });
    // No cost/last-fill mark fallback: open holdings require a valuation producer.
    const saved = await this.db.from("risk_ledger_snapshots").upsert({
      snapshot_key: snapshot.snapshotKey, account_id: account.id, ledger_version: snapshot.version, status: snapshot.status,
      cash_sek: snapshot.cashSek, open_positions: snapshot.openPositions, open_quantity: null, average_cost_sek: null,
      realized_pnl_sek: snapshot.realizedPnlSek, daily_realized_pnl_sek: snapshot.dailyRealizedPnlSek, fees_sek: snapshot.feesSek,
      reserved_exposure_sek: snapshot.reservedBuySek, gross_exposure_sek: snapshot.grossExposureSek, available_cash_sek: snapshot.availableCashSek,
      unknown_reasons: snapshot.unknownReasons, source_fill_ids: fills.map(row => row.id), ledger_payload: snapshot,
      evidence_refs: { fillCoverage: coverage, fx: normalized.map(row => ({ fillId: row.fill.fillId, reference: row.fxReference })), openingReference: account.ledger_history_reference ?? null },
      economic_cutoff_at: economicCutoffAt, information_cutoff_at: cutoffAt, available_at: new Date().toISOString(), result_hash: snapshot.resultHash,
    }, { onConflict: "snapshot_key", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    return { accountKey, providerStatus: providerState.status, riskStatus: snapshot.status, cashSek: snapshot.cashSek,
      openPositions: snapshot.openPositions, reservedExposureSek: snapshot.reservedBuySek, unknownReasons: snapshot.unknownReasons, fillSync: sync };
  }
}
