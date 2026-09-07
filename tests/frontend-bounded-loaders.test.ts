import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadDashboardStockData } from "@/data/dashboard-data";
import { loadFastFlowData } from "@/data/fast-flow-data";
import { loadJackpotData } from "@/data/jackpot-data";
import { loadPaperPortfolioData, loadPaperPortfolioSummaryData } from "@/data/paper-portfolio-data";

type Row = Record<string, any>;
const now = Date.parse("2026-09-07T12:00:00.000Z"), at = new Date(now).toISOString();
const old = "2026-09-07T10:00:00.000Z", before = "2026-09-01T00:00:00.000Z", future = "2026-09-08T00:00:00.000Z";
const uuid = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, "0")}`;

/** Real PostgREST request construction; fetch is intercepted locally and never
 * reaches a network. Filters/order/ranges are applied before returning rows. */
function database(tables: Record<string, Row[]>, failTable?: string, snapshotOverride?: unknown) {
  const requests: Array<{ table: string; url: URL; returned: number }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").at(-1)!;
    if (table === failTable) return new Response(JSON.stringify({ code: "DB_ERROR", message: "private postgres details and secret-test-token" }), { status: 400, headers: { "content-type": "application/json" } });
    if (table === "frontend_paper_snapshot_v1") {
      const snapshot = snapshotOverride === undefined ? paperSnapshot(tables) : snapshotOverride;
      requests.push({ table, url, returned: (snapshot as Row)?.portfolios?.length ?? 0 });
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { "content-type": "application/json" } });
    }
    let rows = [...(tables[table] ?? [])];
    for (const [key, expression] of url.searchParams) {
      if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
      const index = expression.indexOf("."), operator = expression.slice(0, index), wanted = expression.slice(index + 1);
      rows = rows.filter(row => {
        if (operator === "eq") return String(row[key]) === wanted;
        if (operator === "lte") return row[key] != null && String(row[key]) <= wanted;
        if (operator === "gte") return row[key] != null && String(row[key]) >= wanted;
        if (operator === "is") return wanted === "null" && row[key] === null;
        if (operator === "in") return wanted.slice(1, -1).split(",").includes(String(row[key]));
        throw new Error(`Unsupported fixture filter ${operator}`);
      });
    }
    const or = url.searchParams.get("or");
    if (or) {
      const pairs = [...or.matchAll(/and\((\w+)\.eq\.([^,]+),revision_number\.eq\.(\d+)\)/g)];
      expect(pairs.length).toBeGreaterThan(0);
      rows = rows.filter(row => pairs.some(([, column, id, revision]) => row[column] === id && Number(row.revision_number) === Number(revision)));
    }
    const ordering = url.searchParams.get("order")?.split(",") ?? [];
    rows.sort((left, right) => {
      for (const clause of ordering) {
        const [column, direction] = clause.split(".");
        const result = typeof left[column] === "number" && typeof right[column] === "number"
          ? left[column] - right[column] : String(left[column]).localeCompare(String(right[column]));
        if (result) return direction === "desc" ? -result : result;
      }
      return 0;
    });
    const offset = Number(url.searchParams.get("offset") ?? "0"), limit = url.searchParams.get("limit");
    rows = rows.slice(offset, limit === null ? undefined : offset + Number(limit));
    requests.push({ table, url, returned: rows.length });
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  });
  const db = createClient("https://local-fixture.invalid", "fixture-anon-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  return { db, requests };
}

function stockTables() {
  const assets = ["AAPL", "NVDA", "AMD", "TSLA", "MSFT"].map((symbol, index) => ({ id: uuid(index + 1), symbol, kind: "stock" }));
  return { assets, market_prices: assets.map(asset => ({ asset_id: asset.id, close: "110", open: "100", captured_at: at, provider: "finnhub", interval: "quote" })) };
}

function opportunity(id: number, currentRevision = 1): Row {
  return { id: uuid(id), current_revision: currentRevision, opportunity_type: "fast_flow", current_state: "enriching", opportunity_score: 50, data_quality: 80, risk_score: null, updated_at: at, assets: { symbol: `TOKEN-${id}` } };
}
function candidate(id: number, currentRevision = 1): Row {
  return { id: uuid(id), current_revision: currentRevision, current_state: "WATCHING", detected_at: at, assets: { symbol: `TOKEN-${id}` } };
}
function revision(parent: number, revisionNumber: number, delta: Row = {}): Row {
  return { candidate_id: uuid(parent), opportunity_id: uuid(parent), revision_number: revisionNumber, created_at: at, information_cutoff_at: at,
    features: { rawWalletCount: revisionNumber, confirmedIndependent: 2, relationshipCoverage: 80 },
    agent_outputs: { fastFlow: { walletIds: [uuid(91), uuid(92)], relationshipCoverage: 80 } },
    safety_result: { policyVersion: "fast-flow-v1", blockers: ["wallet_independence_unknown"], status: "UNKNOWN" }, evidence_refs: [{ id: "e1" }], ...delta };
}

function portfolio(id = 1): Row {
  return { id: uuid(id), name: `Policy ${id}`, policy_version: `policy-${id}`, initial_capital_sek: "10000", cash_sek: "9000", portfolio_scope: "SYSTEM_RESEARCH", created_at: before };
}
function position(id: number, portfolioId = 1, delta: Row = {}): Row {
  return { id: uuid(id), portfolio_id: uuid(portfolioId), quantity: "1", current_price: "100", market_value: "1000", realized_pnl: "30", unrealized_pnl: "50", closed_at: null, opened_at: before, ...delta };
}
function paperOrder(id: number, portfolioId = 1): Row {
  return { id: uuid(id), portfolio_id: uuid(portfolioId), candidate_id: uuid(100), side: "BUY", requested_amount: "10", executed_amount: "0", execution_price: null, fees: {}, status: "REJECTED", reason: "INSUFFICIENT_DATA", created_at: new Date(now - id * 1000).toISOString(), assets: { symbol: "TOKEN" } };
}

// Fixture DTO only; the actual SQL aggregation is exercised by the independent
// PGlite check in scripts/check-frontend-paper-snapshot.mjs.
function paperSnapshot(tables: Record<string, Row[]>) {
  let reason: string | null = null;
  const headers = (tables.paper_portfolios ?? []).filter(row => row.portfolio_scope === "SYSTEM_RESEARCH");
  if (headers.length > 20) reason = "READ_BUDGET_EXCEEDED";
  const portfolios = headers.map(header => {
    const positions = (tables.paper_positions ?? []).filter(row => row.portfolio_id === header.id), open = positions.filter(row => row.closed_at === null);
    if (positions.length > 5000) reason = "READ_BUDGET_EXCEEDED";
    if (open.some(row => Number(row.quantity) > 0 && (row.current_price === null || Number(row.current_price) <= 0))) reason = "VALUATION_UNAVAILABLE";
    const equity = Number(header.cash_sek) + open.reduce((sum, row) => sum + Number(row.market_value), 0);
    return { id: header.id, name: header.name, policy: header.policy_version, initial: Number(header.initial_capital_sek), cash: Number(header.cash_sek),
      equity, returnPct: (equity / Number(header.initial_capital_sek) - 1) * 100, openPositions: open.length, closedTrades: positions.length - open.length,
      realizedPnl: positions.reduce((sum, row) => sum + Number(row.realized_pnl), 0), unrealizedPnl: open.reduce((sum, row) => sum + Number(row.unrealized_pnl), 0) };
  });
  return { version: "frontend-paper-snapshot-v1", capturedAt: at, status: reason === null ? "READY" : "UNAVAILABLE", reason, portfolios: reason === null ? portfolios : [] };
}

describe("bounded frontend data loaders", () => {
  it("fetches one latest quote per stock despite thousands of observations for another stock", async () => {
    const tables = stockTables();
    for (let index = 0; index < 1500; index++) tables.market_prices.push({ ...tables.market_prices[0], captured_at: new Date(now - index * 1000).toISOString() });
    tables.market_prices.push({ ...tables.market_prices[0], interval: "5m", close: "999" });
    const fixture = database(tables), data = await loadDashboardStockData(fixture.db, now);
    expect(data.stocks).toHaveLength(5);
    expect(data.stocks.every(stock => stock.change === 10)).toBe(true);
    const quotes = fixture.requests.filter(request => request.table === "market_prices");
    expect(quotes).toHaveLength(5);
    expect(quotes.every(request => request.returned === 1 && request.url.searchParams.get("limit") === "1" && request.url.searchParams.has("asset_id"))).toBe(true);
    expect(quotes.every(request => request.url.searchParams.get("order") === "captured_at.desc,provider.asc,interval.asc")).toBe(true);
  });

  it("does not let fresh stocks mask stale or missing stocks", async () => {
    const tables = stockTables();
    tables.market_prices[0].captured_at = old;
    const stale = await loadDashboardStockData(database(tables).db, now);
    expect(stale).toMatchObject({ mode: "stale", updatedAt: old });
    tables.market_prices.pop();
    expect(await loadDashboardStockData(database(tables).db, now)).toMatchObject({ mode: "degraded", stocks: expect.any(Array) });
  });

  it("keeps an invalid latest quote degraded instead of falling back to an older favorable quote", async () => {
    const tables = stockTables();
    tables.market_prices[0].close = "NaN";
    tables.market_prices.push({ ...tables.market_prices[0], close: "110", captured_at: old });
    expect(await loadDashboardStockData(database(tables).db, now)).toMatchObject({ mode: "degraded", stocks: [] });
  });

  it.each(["fast_flow", "jackpot"])("selects the parent-pinned %s revision and does not starve a quiet candidate", async kind => {
    const revisions = Array.from({ length: 1500 }, (_, index) => revision(1, index + 1));
    revisions.push(revision(2, 1));
    const fixture = database(kind === "fast_flow" ? { opportunities: [opportunity(1, 1499), opportunity(2)], opportunity_revisions: revisions }
      : { jackpot_candidates: [candidate(1, 1499), candidate(2)], jackpot_candidate_revisions: revisions });
    const data = kind === "fast_flow" ? await loadFastFlowData(fixture.db, now) : await loadJackpotData(fixture.db, now);
    expect(data.mode).toBe("live");
    expect(data.items).toHaveLength(2);
    const reads = fixture.requests.filter(request => request.table.endsWith("revisions"));
    expect(reads).toHaveLength(1);
    expect(reads[0].returned).toBe(2);
    expect(reads[0].url.searchParams.get("limit")).toBe("2");
    expect(reads[0].url.searchParams.get("or")).toContain("revision_number.eq.1499");
    expect(reads[0].url.searchParams.get("or")).not.toContain("revision_number.eq.1500");
    if (kind === "jackpot") expect(data.items.find(item => item.id === uuid(1))).toMatchObject({ raw: 1499 });
  });

  it("keeps absent current evidence UNKNOWN and never produces an empty blockers safety-pass", async () => {
    const fixture = database({ opportunities: [opportunity(1, 2)], opportunity_revisions: [revision(1, 1)] });
    const data = await loadFastFlowData(fixture.db, now);
    expect(data.mode).toBe("degraded");
    expect(data.items[0].blockers).toContain("CURRENT_REVISION_UNAVAILABLE");
    expect(data.items[0].relationshipCoverage).toBeNull();
    expect(data.items[0].walletCount).toBeNull();
    expect(data.items[0].evidenceCount).toBeNull();
  });

  it("distinguishes a real evaluated empty blocker list from an absent safety payload", async () => {
    const fixture = database({ opportunities: [opportunity(1), opportunity(2)], opportunity_revisions: [revision(1, 1, { safety_result: {} }), revision(2, 1, { safety_result: { policyVersion: "fast-flow-v1", blockers: [] } })] });
    const data = await loadFastFlowData(fixture.db, now);
    expect(data.items.find(item => item.id === uuid(1))?.blockers).toContain("SAFETY_STATUS_UNKNOWN");
    expect(data.items.find(item => item.id === uuid(2))?.blockers).toEqual([]);
  });

  it("keeps empty Jackpot unavailable, old revisions stale, and unavailable revisions unknown", async () => {
    expect(await loadJackpotData(database({}).db, now)).toMatchObject({ mode: "unavailable", items: [], error: null });
    expect(await loadJackpotData(database({ jackpot_candidates: [candidate(1)], jackpot_candidate_revisions: [revision(1, 1, { information_cutoff_at: old })] }).db, now)).toMatchObject({ mode: "stale", updatedAt: old });
    const unavailable = await loadJackpotData(database({ jackpot_candidates: [candidate(1)], jackpot_candidate_revisions: [revision(1, 1, { created_at: future })] }).db, now);
    expect(unavailable).toMatchObject({ mode: "degraded", items: [{ raw: null, coverage: null, safety: "UNKNOWN" }] });
  });

  it("loads the lightweight paper summary from one financial snapshot without fetching any row histories", async () => {
    const fixture = database({ paper_portfolios: [portfolio()], paper_positions: [position(10), position(11, 1, { closed_at: old, market_value: "999999" })], paper_orders: [paperOrder(10)] });
    const data = await loadPaperPortfolioSummaryData(fixture.db, now);
    expect(data).toMatchObject({ mode: "live", error: null, portfolios: [{ cash: 9000, equity: 10000, returnPct: 0, openPositions: 1 }] });
    expect(fixture.requests.map(request => request.table)).toEqual(["frontend_paper_snapshot_v1"]);
    expect(fixture.requests[0].returned).toBe(1);
  });

  it("fetches the latest twenty orders and one performance result independently for each paper policy", async () => {
    const fixture = database({ paper_portfolios: [portfolio(1), portfolio(2)], paper_positions: [position(10), position(11, 1, { closed_at: old }), position(12, 2)],
      paper_orders: [...Array.from({ length: 100 }, (_, index) => paperOrder(index + 1)), paperOrder(101, 2)],
      performance_snapshots: [
        { id: uuid(1), portfolio_id: uuid(1), information_cutoff_at: old, created_at: old, funnel: { marker: 1 } },
        { id: uuid(2), portfolio_id: uuid(1), information_cutoff_at: at, created_at: at, funnel: { marker: 2 } },
        { id: uuid(3), portfolio_id: uuid(2), information_cutoff_at: old, created_at: old, funnel: { marker: 3 } },
      ],
    });
    const data = await loadPaperPortfolioData(fixture.db, now);
    expect(data.portfolios[0]).toMatchObject({ closedTrades: 1, realizedPnl: 60, unrealizedPnl: 50, performance: { funnel: { marker: 2 } } });
    expect(data.portfolios[0].orders).toHaveLength(20);
    expect(data.portfolios[0].orders[0].id).toBe(uuid(1));
    expect(data.portfolios[1].orders).toHaveLength(1);
    expect(data.portfolios[1].performance?.funnel.marker).toBe(3);
    expect(fixture.requests.filter(request => request.table === "paper_orders").map(request => request.returned)).toEqual([20, 1]);
    expect(fixture.requests.filter(request => request.table === "performance_snapshots").every(request => request.returned === 1)).toBe(true);
  });

  it("uses server-computed complete balances instead of a PostgREST position page", async () => {
    const fixture = database({ paper_portfolios: [portfolio()], paper_positions: Array.from({ length: 501 }, (_, index) => position(index + 100, 1, { market_value: "1" })) });
    const data = await loadPaperPortfolioSummaryData(fixture.db, now);
    expect(data.portfolios[0]).toMatchObject({ equity: 9501, openPositions: 501 });
    expect(fixture.requests.map(request => request.table)).toEqual(["frontend_paper_snapshot_v1"]);
  });

  it("fails visibly on the paper read budget instead of displaying a partial total", async () => {
    const fixture = database({ paper_portfolios: [portfolio()], paper_positions: Array.from({ length: 5001 }, (_, index) => position(index + 100, 1, { market_value: "1" })) });
    expect(await loadPaperPortfolioSummaryData(fixture.db, now)).toMatchObject({ mode: "degraded", portfolios: [], error: expect.any(String) });
    expect(fixture.requests.map(request => request.table)).toEqual(["frontend_paper_snapshot_v1"]);
  });

  it("does not display a zero-valued open position when its mark is unknown", async () => {
    const fixture = database({ paper_portfolios: [portfolio()], paper_positions: [position(10, 1, { current_price: null, market_value: "0" })] });
    expect(await loadPaperPortfolioSummaryData(fixture.db, now)).toMatchObject({ mode: "degraded", portfolios: [] });
  });

  it("preserves failed-vs-empty distinction without exposing provider/database errors", async () => {
    const stock = await loadDashboardStockData(database({}, "assets").db, now);
    const fast = await loadFastFlowData(database({}, "opportunities").db, now);
    const jackpot = await loadJackpotData(database({}, "jackpot_candidates").db, now);
    const paper = await loadPaperPortfolioSummaryData(database({}, "frontend_paper_snapshot_v1").db, now);
    for (const data of [stock, fast, jackpot, paper]) {
      expect(data.mode).toBe("degraded");
      expect(JSON.stringify(data)).not.toContain("secret-test-token");
    }
    expect(jackpot.error).toBeTruthy();
    expect(paper.error).toBeTruthy();
    expect(await loadPaperPortfolioSummaryData(database({}).db, now)).toMatchObject({ mode: "unavailable", portfolios: [], error: null });
  });

  it("does not recombine current headers/positions after receiving an earlier consistent snapshot", async () => {
    const tables = { paper_portfolios: [portfolio()], paper_positions: [position(10)] };
    const captured = paperSnapshot(tables);
    // A sale completes after the snapshot. Both states have equity 10,000; the
    // old two-query loader could combine old cash 9,000 and new positions zero.
    tables.paper_portfolios[0].cash_sek = "10000";
    tables.paper_positions[0].closed_at = at;
    const fixture = database(tables, undefined, captured);
    const summary = await loadPaperPortfolioSummaryData(fixture.db, now);
    const full = await loadPaperPortfolioData(fixture.db, now);
    expect(summary.portfolios[0]).toMatchObject({ cash: 9000, equity: 10000, returnPct: 0, openPositions: 1 });
    expect(full.portfolios[0]).toMatchObject(summary.portfolios[0]);
    expect(fixture.requests.some(request => ["paper_portfolios", "paper_positions"].includes(request.table))).toBe(false);
  });

  it.each([null, { version: "unknown", status: "READY", portfolios: [] }, { ...paperSnapshot({}), status: "UNAVAILABLE", reason: "READ_BUDGET_EXCEEDED" }])("fails closed for an absent or invalid snapshot RPC response", async response => {
    const fixture = database({ paper_portfolios: [portfolio()] }, undefined, response);
    expect(await loadPaperPortfolioSummaryData(fixture.db, now)).toMatchObject({ mode: "degraded", portfolios: [], error: expect.any(String) });
    expect(fixture.requests.map(request => request.table)).toEqual(["frontend_paper_snapshot_v1"]);
  });
});
