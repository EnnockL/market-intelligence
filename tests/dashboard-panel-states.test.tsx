import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JackpotRadar } from "@/components/dashboard/jackpot-radar";
import { PaperPortfolioPanel } from "@/components/dashboard/paper-portfolio-panel";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("dashboard failure vs empty states", () => {
  it("does not call an unavailable portfolio an uninitialized portfolio", () => {
    const html = renderToStaticMarkup(<PaperPortfolioPanel data={{ mode: "degraded", portfolios: [], error: "PRIVATE_PROVIDER_ERROR" }} />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No paper portfolios initialized");
    expect(html).not.toContain("PRIVATE_PROVIDER_ERROR");
  });

  it("keeps successful empty portfolios distinct from errors", () => {
    const html = renderToStaticMarkup(<PaperPortfolioPanel data={{ mode: "unavailable", portfolios: [], error: null }} />);
    expect(html).toContain("No paper portfolios initialized");
    expect(html).not.toContain('role="alert"');
  });

  it("does not mislabel a failed jackpot read as no candidates", () => {
    const html = renderToStaticMarkup(<JackpotRadar data={{ mode: "degraded", items: [], updatedAt: null, error: "PRIVATE_PROVIDER_ERROR" }} />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No jackpot candidates yet");
    expect(html).not.toContain("PRIVATE_PROVIDER_ERROR");
  });

  it("preserves candidates with incomplete evidence and clearly labels missing data", () => {
    const html = renderToStaticMarkup(<JackpotRadar data={{ mode: "degraded", updatedAt: null, error: "Incomplete evidence", items: [{
      id: "candidate", symbol: "VISIBLE_TOKEN", state: "DISCOVERED", detectedAt: new Date().toISOString(),
      raw: null, independent: null, coverage: null, liquidity: null, marketCap: null, safety: "UNKNOWN",
    }] }} />);
    expect(html).toContain("VISIBLE_TOKEN");
    expect(html).toContain("Delar av underlaget saknas");
    expect(html).toContain("UNKNOWN");
    expect(html).not.toContain("SAFETY PASS");
  });
});
