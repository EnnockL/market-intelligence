import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), workspaceProps: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.db }));
vi.mock("@/app/strategy-lab/backtest-workspace", () => ({
  BacktestWorkspace: (props: unknown) => { mocks.workspaceProps(props); return null; },
}));
import StrategyLabPage from "@/app/strategy-lab/page";

const sourceId = "11111111-1111-4111-8111-111111111111", assetId = "22222222-2222-4222-8222-222222222222";
function database(lastError: string | null) {
  return { from(table: string) {
    const data = table === "candle_sources" ? [{
      id: sourceId, asset_id: assetId, enabled: true, status: "DEGRADED", timeframe: "5m", provider: "finnhub-candles",
      assets: { symbol: "AMD" }, last_successful_sync: null, last_error: lastError,
      cursor: "PRIVATE_PROVIDER_CURSOR",
    }] : table === "assets" ? [{ id: assetId, symbol: "AMD", kind: "stock", extra_private_column: "PRIVATE_EXTRA_ASSET_FIELD" }] : [];
    const chain: any = { select: () => chain, order: () => chain, eq: () => chain, limit: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return chain;
  } };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("public Strategy Lab provider diagnostics", () => {
  it("renders a generic Swedish error, never raw provider credentials in markup or client props", async () => {
    const privateError = "GET https://provider.invalid/candles?token=PRIVATE_API_KEY_TEST_ONLY Authorization: Bearer PRIVATE_BEARER_TEST_ONLY";
    mocks.db.mockReturnValue(database(privateError));
    const html = renderToStaticMarkup(await StrategyLabPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Datakällan rapporterade ett fel.");
    expect(html).toContain("DEGRADED");
    expect(html).not.toContain("PRIVATE_");
    expect(html).not.toContain("provider.invalid");
    const props = mocks.workspaceProps.mock.calls[0][0];
    expect(JSON.stringify(props)).not.toContain("PRIVATE_");
    expect(props.sources).toEqual([{ id: sourceId, label: "AMD · 5m · finnhub-candles", status: "DEGRADED" }]);
    expect(props.assets).toEqual([{ id: assetId, symbol: "AMD", kind: "stock" }]);
  });
  it("does not invent a provider error when no error is stored", async () => {
    mocks.db.mockReturnValue(database(null));
    const html = renderToStaticMarkup(await StrategyLabPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Datakällan rapporterade ett fel.");
    expect(html).toContain("Candle providers");
  });
});
