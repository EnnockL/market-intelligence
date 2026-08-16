import { describe, expect, it } from "vitest";
import { numberOrNull } from "../src/data/wallet-detail-data";

describe("wallet detail data mapping", () => {
  it("maps Postgres numeric strings without inventing missing values", () => {
    expect(numberOrNull("1832.42")).toBe(1832.42);
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull("not-a-number")).toBeNull();
  });
});
