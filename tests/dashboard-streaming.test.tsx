import React from "react";
import { PassThrough } from "node:stream";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  radar: vi.fn(), stocks: vi.fn(), wallets: vi.fn(), fast: vi.fn(),
  jackpot: vi.fn(), paper: vi.fn(), qualification: vi.fn(),
}));
vi.mock("@/data/market-radar-data", () => ({ getMarketRadarData: mocks.radar }));
vi.mock("@/data/dashboard-data", () => ({ getDashboardStockData: mocks.stocks }));
vi.mock("@/data/wallet-discovery-data", () => ({ getWalletDiscoveryData: mocks.wallets }));
vi.mock("@/data/fast-flow-data", () => ({ getFastFlowData: mocks.fast }));
vi.mock("@/data/jackpot-data", () => ({ getJackpotData: mocks.jackpot }));
vi.mock("@/data/paper-portfolio-data", () => ({ getPaperPortfolioSummaryData: mocks.paper }));
vi.mock("@/data/qualification-data", () => ({ getQualificationData: mocks.qualification }));
vi.mock("@/components/dashboard/wallet-discovery-panel", () => ({ WalletDiscoveryPanel: () => <p>WALLETS_READY</p> }));
vi.mock("@/components/dashboard/fast-flow-panel", () => ({ FastFlowPanel: () => <p>FAST_READY</p> }));
vi.mock("@/components/dashboard/jackpot-radar", () => ({ JackpotRadar: () => <p>JACKPOT_READY</p> }));
vi.mock("@/components/dashboard/paper-portfolio-panel", () => ({ PaperPortfolioPanel: () => <p>PAPER_READY</p> }));
vi.mock("@/components/dashboard/qualification-diagnostics", () => ({ QualificationDiagnostics: () => <p>QUALIFICATION_READY</p> }));
vi.mock("@/components/dashboard/intelligence-panels", () => ({
  RecentSignalsPanel: () => <p>SIGNALS_READY</p>, StockRadarPanel: () => <p>STOCKS_READY</p>,
}));

import Dashboard from "@/app/page";
import Loading from "@/app/loading";
import ErrorPage from "@/app/error";
import { DashboardSection, PanelLoading } from "@/components/dashboard/panel-loading";

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const radarData = {
  mode: "unavailable", updatedAt: null, message: "No observations", pulse: [],
  opportunities: [], recentSignals: [], coverage: { wallets: 0, stocks: 0, tokens: 0 },
};
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("dashboard progressive loading", () => {
  it("sends the shell before reads finish, streams fast panels independently and shares the radar read", async () => {
    const reads = Object.fromEntries(Object.keys(mocks).map(key => [key, deferred()]));
    for (const [key, mock] of Object.entries(mocks)) mock.mockReturnValue(reads[key].promise);
    const output = new PassThrough();
    let html = "";
    const watchers: Array<{ marker: string; done: () => void }> = [];
    const until = (marker: string) => html.includes(marker) ? Promise.resolve() : new Promise<void>(done => watchers.push({ marker, done }));
    output.on("data", chunk => {
      html += String(chunk);
      for (const watcher of watchers) if (html.includes(watcher.marker)) watcher.done();
    });
    const ended = new Promise<void>((resolve, reject) => { output.on("end", resolve); output.on("error", reject); });
    const errors: unknown[] = [];
    const stream = renderToPipeableStream(<Dashboard />, {
      onShellReady() { stream.pipe(output); }, onError(error) { errors.push(error); },
    });
    try {
      await until("HÄMTAR SPARAD DATA");
      expect(html).toContain("Market <em>radar</em>");
      expect(html).not.toContain("FAST_READY");
      reads.fast.resolve({ mode: "unavailable", items: [] });
      await until("FAST_READY");
      expect(html).not.toContain("WALLETS_READY");
      reads.wallets.reject(new Error("PRIVATE_PROVIDER_DETAIL"));
      await until("DATA EJ TILLGÄNGLIG");
      reads.radar.resolve(radarData);
      reads.stocks.resolve({ mode: "unavailable", updatedAt: null, message: "No observations", stocks: [] });
      reads.jackpot.resolve({}); reads.paper.resolve({}); reads.qualification.resolve({});
      await ended;
      expect(html).toContain("STOCKS_READY");
      expect(html).toContain("PAPER_READY");
      expect(html).not.toContain("PRIVATE_PROVIDER_DETAIL");
      expect(errors).toEqual([]);
      for (const mock of Object.values(mocks)) expect(mock).toHaveBeenCalledTimes(1);
    } finally { stream.abort(); output.destroy(); }
  });

  it("makes failed reads explicit without pretending the panel is empty or live", async () => {
    const node = await DashboardSection({ title: "Testpanel", load: () => Promise.reject(new Error("PRIVATE_ERROR")), render: () => <p>0 results</p> });
    const html = renderToStaticMarkup(node);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("PRIVATE_ERROR");
    expect(html).not.toContain("0 results");
  });

  it("has an accessible route fallback without placeholder prices or animated layout shifts", () => {
    expect(renderToStaticMarkup(<Loading />)).toContain("Laddar sidan…");
    const html = renderToStaticMarkup(<PanelLoading title="Stock Radar" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("LIVE");
    expect(html).not.toContain("0 kr");
  });

  it("offers read-only route recovery without leaking the error message", () => {
    const retry = vi.fn();
    const html = renderToStaticMarkup(<ErrorPage retry={retry} error={new Error("SECRET_CONNECTION_STRING")} />);
    expect(html).toContain("Försök ladda sidan igen");
    expect(html).not.toContain("SECRET_CONNECTION_STRING");
    expect(retry).not.toHaveBeenCalled();
  });

  it("handles resolved degraded reads as failures instead of successful empty panels", async () => {
    mocks.radar.mockResolvedValue({ ...radarData, mode: "degraded", message: "PRIVATE_PROVIDER_DETAIL" });
    mocks.wallets.mockResolvedValue({ mode: "degraded", candidates: [], message: "PRIVATE_WALLET_DETAIL" });
    mocks.stocks.mockResolvedValue({ mode: "degraded", stocks: [], message: "PRIVATE_STOCK_DETAIL" });
    mocks.fast.mockResolvedValue({ mode: "degraded", items: [] });
    mocks.jackpot.mockResolvedValue({}); mocks.paper.mockResolvedValue({}); mocks.qualification.mockResolvedValue({});
    const output = new PassThrough();
    let html = "";
    output.on("data", chunk => { html += String(chunk); });
    const ended = new Promise<void>((resolve, reject) => { output.on("end", resolve); output.on("error", reject); });
    const stream = renderToPipeableStream(<Dashboard />, { onAllReady() { stream.pipe(output); } });
    try {
      await ended;
      expect(html).toContain("Marknadsdata kunde inte laddas");
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("PRIVATE_");
      expect(html).not.toContain("WALLETS_READY");
      expect(html).not.toContain("STOCKS_READY");
      expect(html).not.toContain("FAST_READY");
    } finally { stream.abort(); output.destroy(); }
  });
});
