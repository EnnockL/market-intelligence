import { describe, expect, it } from "vitest";
import { analyzeTechnicalStructure, type MarketCandle } from "../src/domain/technical-structure";

function candles(count: number): MarketCandle[] { return Array.from({ length: count }, (_, index) => ({ id: `c-${index}`, assetId: "asset", timeframe: "5m", openedAt: new Date(Date.UTC(2026, 7, 24, 0, index * 5)).toISOString(), closedAt: new Date(Date.UTC(2026, 7, 24, 0, index * 5 + 5)).toISOString(), availableAt: new Date(Date.UTC(2026, 7, 24, 0, index * 5 + 5)).toISOString(), open: 100 + index, high: 101 + index, low: 99 + index, close: 100.5 + index, volume: 100 })); }

describe("technical structure v1", () => {
  it("calculates EMA/VWAP from bounded candles", () => {
    const result = analyzeTechnicalStructure({ assetId: "asset", timeframe: "5m", cutoffAt: "2026-08-24T03:00:00.000Z", exchangeTimeZone: "UTC", candles: candles(30) });
    expect(result.status).toBe("AVAILABLE");
    expect(result.trendState).toBe("BULLISH");
    expect(result.vwap).not.toBeNull();
    expect(result.evidenceRefs).toHaveLength(30);
  });
  it("rejects future and late-available candles", () => {
    const source = candles(20);
    source.push({ ...source[0], id: "future", openedAt: "2026-08-25T00:00:00.000Z", closedAt: "2026-08-25T00:05:00.000Z", availableAt: "2026-08-25T00:05:00.000Z", high: 9999 });
    source.push({ ...source[0], id: "late", availableAt: "2026-08-25T00:05:00.000Z", high: 8888 });
    const result = analyzeTechnicalStructure({ assetId: "asset", timeframe: "5m", cutoffAt: "2026-08-24T03:00:00.000Z", exchangeTimeZone: "UTC", candles: source });
    expect(result.evidenceRefs).not.toContain("future");
    expect(result.evidenceRefs).not.toContain("late");
  });
  it("returns unknown structure with insufficient data", () => {
    const result = analyzeTechnicalStructure({ assetId: "asset", timeframe: "5m", cutoffAt: "2026-08-24T01:00:00.000Z", exchangeTimeZone: "UTC", candles: candles(3) });
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.trendState).toBe("UNKNOWN");
  });
});
