import { describe, expect, it } from "vitest";
import { marketTimeContext } from "../src/domain/market-time";

describe("market time v1", () => {
  it("uses IANA timezones and identifies the New York opening phase", () => {
    const result = marketTimeContext("2026-08-24T12:30:00.000Z", "America/New_York");
    expect(result.marketSession).toBe("NEW_YORK");
    expect(result.sessionPhase).toBe("OPENING");
    expect(result.localExchangeTime).toBe("08:30:00");
  });
  it("keeps unavailable event windows explicitly unknown", () => {
    const result = marketTimeContext("2026-08-24T00:30:00.000Z", "UTC");
    expect(result.marketSession).toBe("ASIA");
    expect(result.earningsWindow).toBe("UNKNOWN");
    expect(result.macroEventWindow).toBe("UNKNOWN");
  });
});
