import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TechnicalStructureService } from "../src/services/technical-structure/service";

describe("TechnicalStructureService candle loading", () => {
  it("paginates beyond the Supabase default result limit with deterministic ranges", async () => {
    const source = Array.from({ length: 1_500 }, (_, index) => ({
      id: `candle-${String(index).padStart(4, "0")}`,
      asset_id: "asset-1",
      timeframe: "5m",
      opened_at: new Date(Date.UTC(2026, 0, 1, 0, index * 5)).toISOString(),
      closed_at: new Date(Date.UTC(2026, 0, 1, 0, index * 5 + 5)).toISOString(),
      available_at: new Date(Date.UTC(2026, 0, 1, 0, index * 5 + 5)).toISOString(),
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    }));
    const ranges: Array<[number, number]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lte", "order"]) builder[method] = vi.fn(() => builder);
    builder.range = vi.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    });
    const db = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const candles = await new TechnicalStructureService(db).loadCandles("asset-1", "5m", "2026-12-31T00:00:00.000Z");

    expect(candles).toHaveLength(1_500);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(candles[1_499]?.id).toBe("candle-1499");
  });
});
