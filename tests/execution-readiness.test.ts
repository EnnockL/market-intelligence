import { describe, expect, it } from "vitest";
import { entryRiskSummary, prospectiveWindowSummary } from "@/domain/execution-readiness";

describe("execution readiness explanations", () => {
  it("never treats missing or unknown risk as room to buy", () => {
    expect(entryRiskSummary({ status: "UNKNOWN", openPositions: 0, exposureSek: 0, maxPositions: 1, maxExposureSek: 200 })).toContain("ofullständigt");
    expect(entryRiskSummary({ status: "KNOWN", openPositions: 0, maxPositions: 1, maxExposureSek: 200 })).toContain("ofullständigt");
  });
  it("explains entry limits without authorizing uncovered sales", () => {
    const message = entryRiskSummary({ status: "KNOWN", openPositions: 5, exposureSek: 10000, maxPositions: 1, maxExposureSek: 200 });
    expect(message).toContain("Nya köp är spärrade");
    expect(message).toContain("kräver fortfarande godkänd signal");
  });
  it("does not promote an ended test to trading approval", () => {
    expect(prospectiveWindowSummary("2026-09-19T00:00:00Z", Date.parse("2026-09-20T00:00:00Z"))).toContain("måste bedömas separat");
    expect(prospectiveWindowSummary(null)).toContain("Ingen registrerad");
  });
});
