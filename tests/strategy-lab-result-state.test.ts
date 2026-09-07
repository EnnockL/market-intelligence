import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialLabValues, labWorkspaceUrl, mapLabRun, requestedLabRun, resolveLabResult, type LabFormValues } from "@/app/strategy-lab/lab-workspace-state";
import { LabResultPanels } from "@/app/strategy-lab/lab-result-panels";

const selected = "11111111-1111-4111-8111-111111111111", unrelated = "22222222-2222-4222-8222-222222222222";
const defaults: LabFormValues = { definitionId: selected, assetId: unrelated, startsAt: "2026-06-09", endsAt: "2026-09-07", sourceId: selected };
const row = (overrides: Record<string, unknown> = {}) => ({
  id: selected, asset_id: unrelated, strategy_definition_id: selected, assets: { symbol: "AMD" },
  strategy_definitions: { name: "ORB selected", version: 2, timeframe: "5m" },
  information_cutoff_at: "2026-01-31T23:59:59.999Z", created_at: "2026-02-01T00:00:00Z", status: "INSUFFICIENT_DATA",
  candle_count: 500, setup_count: 2, trade_count: 1, minimum_sample_size: 30,
  strategy_evaluation_trades: [{ trade_key: "trade-1", entered_at: "2026-01-02T10:00:00Z", exited_at: "2026-01-02T11:00:00Z", r_multiple: "1.5", side: "LONG" }],
  ...overrides,
});
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("Strategy Lab selection and draft state", () => {
  it("round trips January dates, both selections, source and exact run without resetting to today's defaults", () => {
    const values = { ...defaults, startsAt: "2026-01-01", endsAt: "2026-01-31", definitionId: unrelated, assetId: selected };
    const url = new URL(labWorkspaceUrl(values, selected), "http://local.invalid");
    const search = Object.fromEntries(url.searchParams);
    expect(initialLabValues(search, defaults)).toEqual(values);
    expect(requestedLabRun(search)).toBe(selected);
  });
  it.each(["", "2026-02-30", "01/01/2026", "wrong"])("does not replace explicit invalid or empty date %s with today", startsAt => {
    expect(initialLabValues({ startsAt }, defaults).startsAt).toBe("");
  });
  it("only uses initial defaults for absent values and never constructs an external navigation target", () => {
    expect(initialLabValues({}, defaults)).toEqual(defaults);
    expect(labWorkspaceUrl({ ...defaults, assetId: "javascript:alert(1)" }, "https://external.invalid")).toMatch(/^\/strategy-lab\?/);
    expect(requestedLabRun({ run: [selected, unrelated] })).toBe("invalid");
  });
  it("does not select the newest global run when no result is requested", () => {
    expect(resolveLabResult(null, null, { status: "ready", run: mapLabRun(row({ id: unrelated })) }, false, false)).toEqual({ status: "empty", run: null });
  });
  it("hides the previous result while an action or exact-ID navigation is pending", () => {
    const old = { status: "ready" as const, run: mapLabRun(row({ id: unrelated })) };
    expect(resolveLabResult(selected, unrelated, old, true, false)).toEqual({ status: "running", run: null });
    expect(resolveLabResult(selected, unrelated, old, false, false)).toEqual({ status: "loading", run: null });
  });
  it("shows the exact reused older run after navigation, never the newer run", () => {
    const run = mapLabRun(row())!;
    expect(resolveLabResult(selected, selected, { status: "ready", run }, false, false)).toEqual({ status: "ready", run });
    expect(resolveLabResult(selected, selected, { status: "ready", run: mapLabRun(row({ id: unrelated })) }, false, false)).toEqual({ status: "unavailable", run: null });
  });
  it("does not use old success after a failed attempt, or replace missing exact results", () => {
    expect(resolveLabResult(selected, selected, { status: "ready", run: mapLabRun(row()) }, false, true)).toEqual({ status: "failed", run: null });
    expect(resolveLabResult(selected, selected, { status: "empty", run: null }, false, false)).toEqual({ status: "unavailable", run: null });
  });
});

describe("one honest run supplies capital, graph and trade ledger", () => {
  it("labels run identity and insufficient statistical sample beside the actual result", () => {
    const html = renderToStaticMarkup(React.createElement(LabResultPanels, { result: { status: "ready", run: mapLabRun(row())! } }));
    expect(html).toContain(`data-result-run-id="${selected}"`);
    expect(html).toContain("AMD"); expect(html).toContain("ORB selected");
    expect(html).toContain("För litet statistiskt underlag"); expect(html).toContain("1/30");
    expect(html).toContain("Historical cumulative R"); expect(html).not.toContain(unrelated);
  });
  it("distinguishes a successful zero-trade run from an unchanged-capital result", () => {
    const run = mapLabRun(row({ trade_count: 0, strategy_evaluation_trades: [] }))!;
    const html = renderToStaticMarkup(React.createElement(LabResultPanels, { result: { status: "ready", run } }));
    expect(html).toContain("KÖRNING KLAR — 0 TRADES");
    expect(html).not.toContain("HADE DU SLUTAT MED"); expect(html).not.toContain("<svg");
  });
  it.each([
    { trade_count: 1001 },
    { strategy_evaluation_trades: null },
    { strategy_evaluation_trades: [{ trade_key: "trade", entered_at: "2026-01-01", exited_at: "2026-01-02", r_multiple: null }] },
    { strategy_evaluation_trades: [{ trade_key: "trade", entered_at: "2026-01-01", exited_at: "2026-01-02", r_multiple: "NaN" }] },
  ])("does not calculate capital from missing, truncated or invalid trades", overrides => {
    const run = mapLabRun(row(overrides))!;
    expect(run.trades).toBeNull();
    const html = renderToStaticMarkup(React.createElement(LabResultPanels, { result: { status: "ready", run } }));
    expect(html).toContain("HANDELSUNDERLAGET ÄR INTE KOMPLETT"); expect(html).not.toContain("<svg");
    expect(html).not.toContain("HADE DU SLUTAT MED");
  });
  it("does not silently interpret unknown counts as zero", () => {
    expect(mapLabRun(row({ trade_count: null }))).toBeNull();
  });
});
