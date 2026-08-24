import { describe, expect, it } from "vitest";
import { healthStatus, retryDelaySeconds, schedulerBatchLimit } from "../src/domain/forecast-scheduler";

describe("forecast scheduler", () => {
  it("backs off exponentially with a cap", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(99)).toBe(3600);
  });
  it("bounds a full ingestion and research-cycle batch", () => {
    expect(schedulerBatchLimit()).toBe(20);
    expect(schedulerBatchLimit(0)).toBe(1);
    expect(schedulerBatchLimit(999)).toBe(25);
  });
  it("reports paused first", () => expect(healthStatus({ paused: true, consecutiveFailures: 9, heartbeatAt: null, now: "2026-01-01T00:00:00Z", leaseSeconds: 60 })).toBe("PAUSED"));
  it("degrades on one failure and fails on three", () => {
    const base = { paused: false, heartbeatAt: null, now: "2026-01-01T00:00:00Z", leaseSeconds: 60 };
    expect(healthStatus({ ...base, consecutiveFailures: 1 })).toBe("DEGRADED");
    expect(healthStatus({ ...base, consecutiveFailures: 3 })).toBe("FAILED");
  });
  it("detects stale heartbeat", () => expect(healthStatus({ paused: false, consecutiveFailures: 0, heartbeatAt: "2026-01-01T00:00:00Z", now: "2026-01-01T00:03:00Z", leaseSeconds: 60 })).toBe("DEGRADED"));
});
