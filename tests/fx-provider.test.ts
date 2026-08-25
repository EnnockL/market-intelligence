import { describe, it, expect } from "vitest";
import {
  EcbHistoricalFxProvider,
  normalizeEcbCsv,
} from "@/services/fx/ecb-provider";
const csv = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nA,D,USD,EUR,SP00,A,2026-01-02,1.2\nB,D,SEK,EUR,SP00,A,2026-01-02,12.0`;
describe("historical FX", () => {
  it("derives point-in-time USD/SEK from common EUR quotes", () => {
    const [x] = normalizeEcbCsv(csv);
    expect(x.rate).toBe(10);
    expect(x).toMatchObject({
      baseCurrency: "USD",
      quoteCurrency: "SEK",
      effectiveAt: "2026-01-02T15:00:00.000Z",
      availableAt: "2026-01-02T16:00:00.000Z",
    });
  });
  it("returns no fabricated observation when one leg is missing", () =>
    expect(normalizeEcbCsv(csv.split("\n").slice(0, 2).join("\n"))).toEqual(
      [],
    ));
  it("handles provider rate limits explicitly", async () => {
    const provider = new EcbHistoricalFxProvider(
      async () => new Response("", { status: 429 }),
    );
    await expect(
      provider.fetchRange("2026-01-01", "2026-01-02"),
    ).rejects.toThrow("ECB_RATE_LIMITED");
  });
});
