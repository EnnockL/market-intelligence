import { describe, it, expect } from "vitest";
import {
  compareMarket,
  detectNewWalletInflows,
  type MarketObservation,
} from "@/domain/market-events";
const row = (
  id: string,
  change: Partial<MarketObservation> = {},
): MarketObservation => ({
  id,
  assetId: "a",
  provider: "p",
  observedAt: `2026-01-01T00:0${id}:00Z`,
  availableAt: `2026-01-01T00:0${id}:01Z`,
  price: 1,
  volume: 100,
  liquidity: 1000,
  poolAddress: "pool",
  dataQuality: 90,
  ...change,
});
describe("market event producers", () => {
  it("emits no event without baseline", () =>
    expect(compareMarket(row("1"), null)[0]).toMatchObject({
      eventType: null,
      reason: "INSUFFICIENT_HISTORY",
    }));
  it("emits price and volume acceleration with baseline", () =>
    expect(
      compareMarket(row("2", { price: 1.3, volume: 300 }), row("1")).map(
        (x) => x.eventType,
      ),
    ).toEqual(["market.price_accelerated", "market.volume_accelerated"]));
  it("detects liquidity addition and removal", () => {
    expect(
      compareMarket(row("2", { liquidity: 1500 }), row("1"))[0].eventType,
    ).toBe("market.liquidity_added");
    expect(
      compareMarket(row("2", { liquidity: 500 }), row("1"))[0].eventType,
    ).toBe("market.liquidity_removed");
  });
  it("detects pool creation from comparable snapshots", () =>
    expect(
      compareMarket(row("2"), row("1", { poolAddress: null }))[0].eventType,
    ).toBe("pool.created"));
  it("does not fabricate changes from null baseline fields", () =>
    expect(
      compareMarket(
        row("2"),
        row("1", { price: null, volume: null, liquidity: null }),
      ).every((x) => x.eventType === null || x.eventType === "pool.created"),
    ).toBe(true));
});

describe("new wallet inflow", () => {
  it("uses first buys and exposes partial coverage", () => {
    const result = detectNewWalletInflows(
      [
        ["w1", "1", "00:00:00"],
        ["w1", "2", "00:00:10"],
        ["w2", "3", "00:01:00"],
        ["w3", "4", "00:02:00"],
      ].map(([walletId, transactionId, time]) => ({
        walletId,
        assetId: "a",
        transactionId,
        occurredAt: `2026-01-01T${time}Z`,
        availableAt: `2026-01-01T${time}.500Z`,
      })),
      10,
    )[0];
    expect(result.eventType).toBe("market.new_wallet_inflow");
    expect(result.payload).toMatchObject({
      newWalletsDetected: 3,
      walletObservationCoverage: 30,
      classification: "PARTIAL_COVERAGE",
    });
  });

  it("emits nothing below the deterministic threshold", () => {
    expect(
      detectNewWalletInflows(
        [
          {
            walletId: "w1",
            assetId: "a",
            transactionId: "1",
            occurredAt: "2026-01-01T00:00:00Z",
            availableAt: "2026-01-01T00:00:01Z",
          },
        ],
        1,
      ),
    ).toEqual([]);
  });
});
