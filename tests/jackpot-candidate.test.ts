import { describe, expect, it } from "vitest";
import { calculateJackpotOutcome, collectorKey, eventLatencyFeatures, nextJackpotState } from "@/domain/jackpot-candidate";

describe("Jackpot collector v1", () => {
  it("discovers new tokens", () => expect(nextJackpotState("DISCOVERED", "token.created", "UNKNOWN", 80)).toBe("DISCOVERED"));
  it("wallet convergence creates watching", () => expect(nextJackpotState("DISCOVERED", "wallet.buy_detected", "UNKNOWN", 80)).toBe("WATCHING"));
  it("safety fail rejects while unknown may watch", () => {
    expect(nextJackpotState("DISCOVERED", "wallet.buy_detected", "FAIL", 90)).toBe("REJECTED");
    expect(nextJackpotState("DISCOVERED", "wallet.buy_detected", "UNKNOWN", 90)).toBe("WATCHING");
  });
  it("price acceleration creates accelerating state", () => expect(nextJackpotState("WATCHING", "market.price_accelerated", "PASS", 90)).toBe("ACCELERATING"));
  it("dedupe key is deterministic", () => expect(collectorKey("a", "s", "w")).toBe(collectorKey("a", "s", "w")));
  it("detects 2x and 10x without inventing 50x", () => {
    const result = calculateJackpotOutcome("2026-01-01T00:00:00Z", 1, [{ at: "2026-01-01T00:01:00Z", price: .8 }, { at: "2026-01-01T00:05:00Z", price: 2 }, { at: "2026-01-01T00:15:00Z", price: 10 }]);
    expect(result.timeTo["2x"]).toBe(300000); expect(result.timeTo["10x"]).toBe(900000); expect(result.timeTo["50x"]).toBeNull(); expect(result.mfe).toBe(900); expect(result.mae).toBeCloseTo(-20);
  });
  it("returns null outcomes without prices", () => expect(calculateJackpotOutcome("2026-01-01T00:00:00Z", 1, []).maxMultiple).toBeNull());
  it("does not label pool observation delay as first-buy latency", () => expect(eventLatencyFeatures("pool.created", "2026-01-01T00:00:00Z", "2026-01-01T00:00:57Z")).toEqual({ sourceObservationLatencyMs: 57000, latencyFromFirstBuyMs: null, latencyFromConvergenceMs: null }));
  it("records wallet and convergence latency only for matching events", () => {
    expect(eventLatencyFeatures("wallet.buy_detected", "2026-01-01T00:00:00Z", "2026-01-01T00:00:05Z").latencyFromFirstBuyMs).toBe(5000);
    expect(eventLatencyFeatures("opportunity.fast_created", "2026-01-01T00:00:00Z", "2026-01-01T00:00:07Z").latencyFromConvergenceMs).toBe(7000);
  });
});
