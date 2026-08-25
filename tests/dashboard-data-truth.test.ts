import { describe, expect, it } from "vitest";
import { dataModeAt, latestTimestamp, LIVE_WINDOW_MS } from "@/data/data-truth";

describe("dashboard data truth", () => {
  const now = Date.parse("2026-08-24T20:00:00.000Z");

  it("marks recent observations live and old observations stale", () => {
    expect(dataModeAt(new Date(now - LIVE_WINDOW_MS).toISOString(), now)).toBe("live");
    expect(dataModeAt(new Date(now - LIVE_WINDOW_MS - 1).toISOString(), now)).toBe("stale");
  });

  it("never presents missing or malformed timestamps as live", () => {
    expect(dataModeAt(null, now)).toBe("unavailable");
    expect(dataModeAt("not-a-date", now)).toBe("unavailable");
  });

  it("selects the newest valid provider timestamp deterministically", () => {
    expect(latestTimestamp([null, "2026-08-24T19:00:00.000Z", "invalid", "2026-08-24T19:30:00.000Z"])).toBe("2026-08-24T19:30:00.000Z");
  });
});
