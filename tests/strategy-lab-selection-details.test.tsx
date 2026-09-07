import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runBacktest: vi.fn(), syncCandleSource: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), unstable_rethrow: vi.fn() }));
vi.mock("@/app/strategy-lab/actions", () => ({ runBacktest: mocks.runBacktest, syncCandleSource: mocks.syncCandleSource }));
vi.mock("@/app/strategy-lab/lab-result-panels", () => ({
  LabResultPanels: ({ result }: { result: { status: string } }) => <div data-result-status={result.status} />,
}));
import { BacktestWorkspace, type BacktestWorkspaceProps } from "@/app/strategy-lab/backtest-workspace";

const definitionId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const unknownRunId = "55555555-5555-4555-8555-555555555555";
const strategyName = "Opening Range Breakout - Fifteen Minute Retest - Extended Research Rule Version";
const assetSymbol = "SOL-VERY-LONG-ON-CHAIN-ASSET-IDENTIFIER-1234567890";
const sourceLabel = `${assetSymbol} · 5m · historical-provider-with-a-long-name`;
const runLabel = `${assetSymbol} · ${strategyName} · 2026-01-01 · ${runId}`;

function props(): BacktestWorkspaceProps {
  return {
    definitions: [{ id: definitionId, name: strategyName, timeframe: "5m" }],
    assets: [{ id: assetId, symbol: assetSymbol, kind: "crypto" }],
    sources: [{ id: sourceId, label: sourceLabel, status: "HEALTHY" }],
    runs: [{ id: runId, label: runLabel }],
    initialValues: { definitionId, assetId, sourceId, startsAt: "2026-01-01", endsAt: "2026-08-31" },
    requestedRunId: runId,
    result: { status: "unavailable", run: null },
  };
}

function selectionDetails(html: string) {
  return [...html.matchAll(/<select\b[^>]*aria-describedby="([^"]+)"[^>]*>/g)].map(match => {
    const id = match[1];
    const paragraph = html.match(new RegExp(`<p id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>(.*?)</p>`));
    expect(paragraph, `Visible description for ${id}`).not.toBeNull();
    // Descriptions stay outside the label so the input's accessible name is not repeated.
    const containingLabel = [...html.matchAll(/<label\b[^>]*>.*?<\/label>/g)].find(label => label[0].includes(`aria-describedby="${id}"`));
    expect(containingLabel).toBeDefined();
    expect(containingLabel![0]).not.toContain(`<p id="${id}"`);
    return paragraph![1];
  });
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("Strategy Lab full selected labels", () => {
  it("keeps native selects and exposes all four complete labels in associated visible descriptions", () => {
    const html = renderToStaticMarkup(<BacktestWorkspace {...props()} />);
    const descriptions = selectionDetails(html);
    expect(descriptions).toHaveLength(4);
    expect(descriptions[0]).toBe(`${strategyName} · 5m`);
    expect(descriptions[1]).toBe(`${assetSymbol} · crypto`);
    expect(descriptions[2]).toBe(`${sourceLabel} · HEALTHY`);
    expect(descriptions[3]).toContain(runLabel);
    expect(html).not.toContain('role="combobox"');
    expect(mocks.runBacktest).not.toHaveBeenCalled();
    expect(mocks.syncCandleSource).not.toHaveBeenCalled();
  });

  it("describes an unknown selected run honestly without substituting another saved result or changing dates", () => {
    const input = props();
    input.requestedRunId = unknownRunId;
    const html = renderToStaticMarkup(<BacktestWorkspace {...input} />);
    const selectedRun = selectionDetails(html)[3];
    expect(selectedRun).toBe(`Vald körning · ${unknownRunId} · Resultatet är inte tillgängligt.`);
    expect(selectedRun).not.toContain(runLabel);
    expect(html).toContain('data-result-status="unavailable"');
    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain('value="2026-08-31"');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses the exact loaded run label when that run lies outside the recent-run options", () => {
    const input = props();
    input.requestedRunId = unknownRunId;
    input.result = { status: "ready", run: {
      id: unknownRunId, assetId, symbol: assetSymbol, definitionId, strategyName,
      timeframe: "5m", version: "1", cutoffAt: "2026-08-31T00:00:00Z", createdAt: "2026-09-01T00:00:00Z",
      status: "INSUFFICIENT_DATA", candleCount: 100, setupCount: 0, tradeCount: 0, minimumSampleSize: 30, trades: [],
    } };
    const html = renderToStaticMarkup(<BacktestWorkspace {...input} />);
    expect(selectionDetails(html)[3]).toBe(`${assetSymbol} · ${strategyName} · ${unknownRunId}`);
    expect(html).toContain('data-result-status="ready"');
  });

  it("shows explicit missing-selection descriptions rather than the first available options", () => {
    const input = props();
    input.initialValues = { ...input.initialValues, definitionId: unknownRunId, assetId: unknownRunId, sourceId: unknownRunId };
    input.requestedRunId = null;
    input.result = { status: "empty", run: null };
    const html = renderToStaticMarkup(<BacktestWorkspace {...input} />);
    expect(selectionDetails(html)).toEqual([
      "Vald strategi är inte tillgänglig", "Vald asset är inte tillgänglig", "Vald källa är inte tillgänglig", "Välj ett sparat resultat",
    ]);
  });

  it("renders labels as escaped text and ignores raw provider errors outside the safe source DTO", () => {
    const input = props();
    input.definitions[0].name = '<script>alert("label")</script>';
    Object.assign(input.sources[0], { last_error: "Bearer PRIVATE_PROVIDER_TOKEN" });
    const html = renderToStaticMarkup(<BacktestWorkspace {...input} />);
    expect(selectionDetails(html)[0]).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("label")</script>');
    expect(html).not.toContain("PRIVATE_PROVIDER_TOKEN");
  });
});
