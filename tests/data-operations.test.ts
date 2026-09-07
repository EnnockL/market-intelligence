import { describe, expect, it } from "vitest";
import { ageLabel, classifyOperationsStatus, pipelineReadStatus, processedRecordCount, SAFE_MANUAL_JOB_TYPES } from "../src/domain/data-operations";

const now = new Date("2026-08-25T12:00:00.000Z");
describe("data operations truth rules", () => {
  it("never presents absent data as live", () => expect(classifyOperationsStatus({ lastSuccessAt: null, freshnessSeconds: 60, now })).toBe("UNAVAILABLE"));
  it("marks a fresh successful observation live", () => expect(classifyOperationsStatus({ lastSuccessAt: "2026-08-25T11:59:30.000Z", latestStatus: "succeeded", freshnessSeconds: 60, now })).toBe("LIVE"));
  it("marks old data stale", () => expect(classifyOperationsStatus({ lastSuccessAt: "2026-08-25T11:00:00.000Z", latestStatus: "succeeded", freshnessSeconds: 60, now })).toBe("STALE"));
  it("surfaces a latest provider failure as degraded", () => expect(classifyOperationsStatus({ lastSuccessAt: "2026-08-25T11:59:30.000Z", latestStatus: "failed", freshnessSeconds: 60, now })).toBe("DEGRADED"));
  it("never allowlists execution", () => { expect(SAFE_MANUAL_JOB_TYPES.has("STOCK_INGESTION")).toBe(true); expect(SAFE_MANUAL_JOB_TYPES.has("EXECUTION_PIPELINE")).toBe(false); expect(SAFE_MANUAL_JOB_TYPES.has("TRADE_PROPOSAL_PRODUCER")).toBe(false); });
  it("renders explicit age labels", () => expect(ageLabel("2026-08-25T11:55:00.000Z", now)).toBe("5m ago"));
  it("keeps never-successful failures visible", () => expect(classifyOperationsStatus({ lastSuccessAt: null, latestStatus: "FAILED", freshnessSeconds: 60, now })).toBe("DEGRADED"));
  it("does not turn a future or invalid timestamp into zero seconds ago", () => {
    expect(ageLabel("2026-08-26T12:00:00Z", now)).toContain("Future timestamp");
    expect(ageLabel("invalid", now)).toBe("Invalid timestamp");
  });
  it("checks actual freshness instead of a saved HEALTHY flag", () => {
    const job = { enabled: true, status: "HEALTHY", interval_seconds: 60, last_successful_run_at: "2026-08-25T11:00:00Z" };
    expect(pipelineReadStatus(job, now)).toBe("STALE");
    expect(pipelineReadStatus({ ...job, enabled: false }, now)).toBe("PAUSED");
  });
  it("distinguishes missing worker metrics from successful zero-record runs", () => {
    expect(processedRecordCount({})).toBeNull();
    expect(processedRecordCount({ recordsProcessed: 0 })).toBe(0);
    expect(processedRecordCount({ records_processed: "25" })).toBe(25);
    expect(processedRecordCount({ records: -1 })).toBeNull();
  });
});
