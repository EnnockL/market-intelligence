import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountLedgerSnapshotV2 } from "@/domain/account-ledger-v2";
import { verifyAccountLedgerV2Snapshot } from "@/domain/account-ledger-v2";
import { AccountStateService } from "@/services/execution/account-state-service";
import type { ExecutionProvider, ProviderAccountState } from "@/services/execution/provider";

type Row = Record<string, unknown>;
type Filter = { operation: "eq" | "gte" | "lte"; column: string; value: unknown };
type Query = { table: string; filters: Filter[]; ordering: string[]; range: [number, number] | null };
type Write = { table: string; value: Row; options: unknown };
const baseline = "2026-09-01T00:00:00.000Z";
const cutoff = "2026-09-07T12:00:00.000Z";
const providerName = "capture-test-provider";
const accountId = "capture-account";
const coverage = { through: cutoff, checkpointCount: 12, checkpointHash: "checkpoint-fixture-hash" };

function account(delta: Row = {}): Row {
  return {
    id: accountId, account_key: `${providerName}-primary`, provider: providerName,
    provider_environment: "DEMO", status: "PAUSED", revision: 7, initial_cash_sek: "10000",
    ledger_baseline_at: baseline, ledger_opening_status: "DECLARED",
    ledger_history_verified_through: cutoff, ledger_history_reference: "opening-cash-zero-inventory-test",
    ...delta,
  };
}

function fill(id: string, delta: Row = {}): Row {
  return {
    id, account_id: accountId, provider: providerName, provider_environment: "DEMO",
    provenance_status: "VERIFIED_PROVIDER", provider_order_id: `provider-order-${id}`,
    order_id: null, mapping_status: "EXTERNAL_ORDER", instrument_id: "BTC-USD", side: "BUY",
    quantity: "1", price: "100", fee_amount: "1", fee_currency: "USD",
    base_currency: "BTC", quote_currency: "USD", occurred_at: "2026-09-03T10:00:00.000Z",
    available_at: "2026-09-03T10:00:01.000Z", ...delta,
  };
}

function order(id: string, delta: Row = {}): Row {
  return {
    id, account_id: accountId, provider: providerName, provider_environment: "DEMO",
    provider_order_id: `provider-order-${id}`, current_state: "FILLED", filled_quantity: "1",
    reservation_fee_buffer_sek: "0", updated_at: "2026-09-06T10:00:00.000Z",
    execution_intents: { instrument_id: "BTC-USD", side: "BUY", quantity: "1", quote_amount_sek: "1000" },
    ...delta,
  };
}

const directFx: Row = {
  id: "direct-usd-sek", base_currency: "USD", quote_currency: "SEK", rate: "10",
  effective_at: baseline, observed_at: baseline, available_at: baseline,
  data_quality: 100, provider: "historical-fx-test", source_reference: "direct-fx-source",
};

function closedCycles(): Row[] {
  return [
    fill("btc-buy"),
    fill("btc-sell", { side: "SELL", price: "110", occurred_at: "2026-09-06T10:00:00.000Z", available_at: "2026-09-06T10:00:01.000Z" }),
    fill("eth-buy", { instrument_id: "ETH-USD", base_currency: "ETH", quantity: "2", price: "50", fee_amount: "0.5", occurred_at: "2026-09-06T11:00:00.000Z", available_at: "2026-09-06T11:00:01.000Z" }),
    fill("eth-sell", { instrument_id: "ETH-USD", base_currency: "ETH", side: "SELL", quantity: "2", price: "55", fee_amount: "-0.5", occurred_at: "2026-09-07T10:00:00.000Z", available_at: "2026-09-07T10:00:01.000Z" }),
  ];
}

/** The mock applies predicates and ranges; it does not merely return expected data. */
function fixture(options: {
  account?: Row; fills?: Row[]; orders?: Row[]; rates?: Row[];
  coverage?: typeof coverage | null; providerState?: Partial<ProviderAccountState>;
} = {}) {
  const rows: Record<string, Row[]> = {
    execution_accounts: [options.account ?? account()], execution_fills: options.fills ?? [],
    execution_orders: options.orders ?? [], fx_observations: options.rates ?? [directFx],
  };
  const queries: Query[] = [], writes: Write[] = [];
  const rpc = vi.fn(async (name: string, parameters: Row) => {
    expect(name).toBe("execution_fill_coverage_v1");
    expect(parameters).toEqual({ p_account_id: accountId, p_provider: providerName, p_environment: "DEMO", p_baseline_at: baseline, p_cutoff_at: cutoff });
    return { data: options.coverage === undefined ? coverage : options.coverage, error: null };
  });
  const db = {
    rpc,
    from(table: string) {
      const query: Query = { table, filters: [], ordering: [], range: null };
      let write: Write | null = null;
      const execute = () => {
        if (write) { writes.push(write); return { data: [], error: null }; }
        queries.push(query);
        let data = [...(rows[table] ?? [])].filter(row => query.filters.every(filter => {
          const value = row[filter.column];
          if (value === null || value === undefined) return false;
          if (filter.operation === "eq") return value === filter.value;
          return filter.operation === "gte" ? String(value) >= String(filter.value) : String(value) <= String(filter.value);
        }));
        data.sort((left, right) => {
          for (const key of query.ordering) {
            const comparison = String(left[key]).localeCompare(String(right[key]));
            if (comparison) return comparison;
          }
          return 0;
        });
        if (query.range) data = data.slice(query.range[0], query.range[1] + 1);
        return { data, error: null };
      };
      const builder = {
        select(_columns: string) { return builder; },
        eq(column: string, value: unknown) { query.filters.push({ operation: "eq", column, value }); return builder; },
        gte(column: string, value: unknown) { query.filters.push({ operation: "gte", column, value }); return builder; },
        lte(column: string, value: unknown) { query.filters.push({ operation: "lte", column, value }); return builder; },
        order(column: string) { query.ordering.push(column); return builder; },
        range(from: number, to: number) { query.range = [from, to]; return builder; },
        upsert(value: Row, upsertOptions: unknown) { write = { table, value, options: upsertOptions }; return builder; },
        async single() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
        then(resolve: (result: { data: Row[]; error: null }) => unknown) { return Promise.resolve(execute()).then(resolve); },
      };
      return builder;
    },
  };
  const getFillsPage = vi.fn(async () => { throw new Error("Historical capture must not import provider fills"); });
  const getAccountState = vi.fn(async (): Promise<ProviderAccountState> => ({
    balances: [], positions: [], totalEquityUsd: null, availableQuoteUsd: null,
    status: "KNOWN", unknownReasons: [], observedAt: cutoff, sourceReference: "mock-account-observation",
    ...options.providerState,
  }));
  const provider = { name: providerName, mode: "DEMO", getAccountState, getFillsPage } as unknown as ExecutionProvider;
  const service = new AccountStateService(db as unknown as SupabaseClient, provider);
  const saved = () => {
    const write = writes.find(item => item.table === "risk_ledger_snapshots");
    expect(write).toBeDefined();
    return write!.value;
  };
  return { service, queries, writes, rpc, getFillsPage, getAccountState, saved, payload: () => saved().ledger_payload as AccountLedgerSnapshotV2 };
}

describe("account ledger capture with bounded local Supabase fixtures", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(cutoff)); });
  afterEach(() => { vi.useRealTimers(); });

  it("loads verified fills from the declared baseline, scoped by account/provider/environment and both cutoffs", async () => {
    const included = closedCycles();
    const noise = [
      fill("other-account", { account_id: "other-account" }),
      fill("other-provider", { provider: "other-provider" }),
      fill("live-not-demo", { provider_environment: "LIVE" }),
      fill("unverified", { provenance_status: "LEGACY_UNVERIFIED" }),
      fill("future-available", { available_at: "2026-09-07T12:00:01.000Z" }),
      fill("future-event", { occurred_at: "2026-09-07T12:00:01.000Z", available_at: "2026-09-07T12:00:01.000Z" }),
      fill("before-baseline", { occurred_at: "2026-08-31T23:59:59.000Z" }),
    ];
    const test = fixture({ fills: [...noise, ...included] });
    await test.service.capture(cutoff);
    expect(test.saved().source_fill_ids).toEqual(included.map(row => row.id));
    expect(test.queries.find(query => query.table === "execution_fills")).toEqual({
      table: "execution_fills", range: [0, 499], ordering: ["occurred_at", "id"], filters: [
        { operation: "eq", column: "account_id", value: accountId },
        { operation: "eq", column: "provider", value: providerName },
        { operation: "eq", column: "provider_environment", value: "DEMO" },
        { operation: "eq", column: "provenance_status", value: "VERIFIED_PROVIDER" },
        { operation: "gte", column: "occurred_at", value: baseline },
        { operation: "lte", column: "occurred_at", value: cutoff },
        { operation: "lte", column: "available_at", value: cutoff },
      ],
    });
    expect(test.rpc).toHaveBeenCalledOnce();
    expect(test.getFillsPage).not.toHaveBeenCalled();
    expect(test.queries.some(query => query.table === "execution_fill_sync_states")).toBe(false);
  });

  it("persists v2, historical SEK values, signed fees and explicit provenance without conflating lifetime and daily PnL", async () => {
    const test = fixture({ fills: closedCycles() });
    const result = await test.service.capture(cutoff);
    // The earlier BTC cycle earns 80 SEK; today's ETH cycle earns 100 SEK.
    expect(test.saved()).toMatchObject({ ledger_version: "account-ledger-v2", account_id: accountId,
      cash_sek: 10180, realized_pnl_sek: 180, daily_realized_pnl_sek: 100, fees_sek: 20,
      open_quantity: null, average_cost_sek: null, open_positions: 0, gross_exposure_sek: 0,
      available_cash_sek: 10180, information_cutoff_at: cutoff, economic_cutoff_at: cutoff,
      evidence_refs: { fillCoverage: coverage, openingReference: "opening-cash-zero-inventory-test", fx: closedCycles().map(row => ({ fillId: row.id, reference: "fx_observations:direct-usd-sek:historical-fx-test:direct-fx-source" })) },
    });
    expect(test.payload()).toMatchObject({ baselineAt: baseline, dailyWindowStartAt: "2026-09-07T00:00:00.000Z",
      feesSek: 20, grossFeesSek: 25, rebatesSek: 5, dailyFeesSek: -5,
      positions: [ { instrumentId: "BTC-USD", quantity: 0, realizedPnlSek: 80 }, { instrumentId: "ETH-USD", quantity: 0, realizedPnlSek: 100 } ],
    });
    expect(verifyAccountLedgerV2Snapshot(test.payload())).toBe(true);
    expect(test.saved().result_hash).toBe(test.payload().resultHash);
    expect(result.riskStatus).toBe("UNKNOWN");
    expect(result.unknownReasons).toEqual(["HISTORICAL_PENDING_ORDER_SNAPSHOT_UNAVAILABLE", "PROVIDER_OPEN_ORDERS_COVERAGE_UNKNOWN"]);
    expect(test.writes.find(write => write.table === "risk_ledger_snapshots")?.options).toEqual({ onConflict: "snapshot_key", ignoreDuplicates: true });
  });

  it("keeps distinct instrument inventory and never sums units or uses fill prices as current marks", async () => {
    const cycles = closedCycles();
    const test = fixture({ fills: [cycles[0], cycles[2]] });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ cash_sek: 7985, open_positions: 2, open_quantity: null, average_cost_sek: null, gross_exposure_sek: null, status: "UNKNOWN" });
    expect(test.payload().positions).toMatchObject([
      { instrumentId: "BTC-USD", quantity: 1, averageCostSek: 1010, marketValueSek: null },
      { instrumentId: "ETH-USD", quantity: 2, averageCostSek: 502.5, marketValueSek: null },
    ]);
    expect(test.payload().unknownReasons).toEqual(expect.arrayContaining(["CURRENT_MARK_MISSING:BTC-USD", "CURRENT_MARK_MISSING:ETH-USD"]));
  });

  it.each([
    { ledger_baseline_at: null, initial_cash_sek: null, ledger_opening_status: "UNKNOWN" },
    { ledger_opening_status: "UNKNOWN" },
  ])("does not initialize or declare SEK opening cash from provider USD balances: %j", async delta => {
    const test = fixture({ account: account(delta), providerState: { balances: [{ currency: "USD", total: 1234, available: 1200 }], totalEquityUsd: 1234, availableQuoteUsd: 1200 } });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ status: "UNKNOWN", cash_sek: null });
    expect(test.payload().unknownReasons).toEqual(expect.arrayContaining(["OPENING_CASH_NOT_DECLARED", "MULTI_CURRENCY_CASH_RECONCILIATION_REQUIRED"]));
    expect(test.writes.filter(write => write.table === "execution_accounts")).toEqual([
      { table: "execution_accounts", value: { account_key: `${providerName}-primary`, provider: providerName, provider_environment: "DEMO", status: "ACTIVE" }, options: { onConflict: "account_key", ignoreDuplicates: true } },
    ]);
    if (delta.ledger_baseline_at === null) {
      expect(test.rpc).not.toHaveBeenCalled();
      expect(test.queries.some(query => query.table === "execution_fills")).toBe(false);
    }
  });

  it.each([
    { name: "old unmapped fill", row: order("legacy-old", { account_id: null, updated_at: "2026-08-31T00:00:00.000Z" }), reason: "LEGACY_ORDER_ACCOUNT_UNKNOWN" },
    { name: "new unmapped pending order", row: order("legacy-new", { account_id: null, current_state: "SUBMITTED", filled_quantity: "0" }), reason: "LEGACY_ORDER_ACCOUNT_UNKNOWN" },
    { name: "old mapped order without retained fills", row: order("mapped-old", { updated_at: "2026-08-31T00:00:00.000Z" }), reason: "ORDER_FILL_RECONCILIATION_REQUIRED:mapped-old" },
    { name: "new mapped order without verified fills", row: order("mapped-new"), reason: "ORDER_FILL_RECONCILIATION_REQUIRED:mapped-new" },
  ])("keeps $name UNKNOWN rather than manufacturing fills", async ({ row, reason }) => {
    const test = fixture({ orders: [row] });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ status: "UNKNOWN", source_fill_ids: [] });
    expect(test.payload().unknownReasons).toContain(reason);
  });

  it("reconciles originally external fills by exact provider-order and instrument identity, not mutable local order mapping", async () => {
    const rows = closedCycles();
    const orders = rows.map(row => order(String(row.id), { filled_quantity: row.quantity, execution_intents: { instrument_id: row.instrument_id, side: row.side, quantity: row.quantity, quote_amount_sek: "1000" } }));
    orders.push(order("other-account", { account_id: "other-account", current_state: "SUBMITTED", filled_quantity: "999" }));
    orders.push(order("other-provider-legacy", { account_id: null, provider: "other-provider" }));
    orders.push(order("live-legacy", { account_id: null, provider_environment: "LIVE" }));
    const test = fixture({ fills: rows, orders });
    await test.service.capture(cutoff);
    expect(test.payload().unknownReasons.some(reason => reason.includes("ORDER_FILL_RECONCILIATION") || reason === "LEGACY_ORDER_ACCOUNT_UNKNOWN")).toBe(false);
    expect(test.payload().pendingOrders).toEqual([]);
    expect(test.payload().reservedBuySek).toBe(0);

    const wrongInstrument = fixture({ fills: rows, orders: [order("btc-buy", { execution_intents: { instrument_id: "ETH-USD", side: "BUY", quantity: "1", quote_amount_sek: "1000" } })] });
    await wrongInstrument.service.capture(cutoff);
    expect(wrongInstrument.payload().unknownReasons).toContain("ORDER_FILL_RECONCILIATION_REQUIRED:btc-buy");
  });

  it("limits economic facts to the completed coverage boundary, even when later facts were already available", async () => {
    const through = "2026-09-07T11:00:00.000Z";
    const test = fixture({ coverage: { ...coverage, through }, fills: [...closedCycles(), fill("not-covered", { occurred_at: "2026-09-07T11:30:00.000Z", available_at: "2026-09-07T11:30:01.000Z" })] });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ economic_cutoff_at: through, information_cutoff_at: cutoff, source_fill_ids: closedCycles().map(row => row.id), cash_sek: 10180 });
    expect(test.payload().economicCutoffAt).toBe(through);
  });

  it("does not compute a complete ledger from fills when the provider window has a gap", async () => {
    const test = fixture({ coverage: null, fills: closedCycles() });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ status: "UNKNOWN", cash_sek: null, realized_pnl_sek: null });
    expect(test.payload().unknownReasons).toContain("FILL_HISTORY_INCOMPLETE");
  });

  it("does not use future-available direct FX or assume stablecoin parity", async () => {
    const test = fixture({ fills: [fill("unpriced-usdt", { instrument_id: "BTC-USDT", quote_currency: "USDT", fee_currency: "USDT" })], rates: [directFx, { ...directFx, id: "future-usdt-sek", base_currency: "USDT", available_at: "2026-09-07T12:00:01.000Z" }] });
    await test.service.capture(cutoff);
    expect(test.saved()).toMatchObject({ status: "UNKNOWN", cash_sek: null, evidence_refs: { fx: [{ fillId: "unpriced-usdt", reference: null }] } });
    expect(test.payload().unknownReasons).toContain("FILL_VALUE_UNKNOWN:unpriced-usdt");
  });

  it("reads the second bounded page instead of silently treating 500 fills as the full history", async () => {
    const fills = Array.from({ length: 501 }, (_, index) => fill(`page-${String(index).padStart(3, "0")}`, { quantity: "0.001", fee_amount: "0" }));
    const test = fixture({ fills });
    await test.service.capture(cutoff);
    expect(test.queries.filter(query => query.table === "execution_fills").map(query => query.range)).toEqual([[0, 499], [500, 999]]);
    expect(test.saved().source_fill_ids).toHaveLength(501);
    expect(test.payload().positions[0].quantity).toBeCloseTo(0.501, 12);
  });
});
