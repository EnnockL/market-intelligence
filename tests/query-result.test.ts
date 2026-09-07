import { describe, expect, it } from "vitest";
import { readQuery, readCount } from "@/data/query-result";

describe("public read result contract", () => {
  it("separates a real zero from a failed or missing count", async () => {
    expect(await readCount(Promise.resolve({ count: 0 }))).toMatchObject({ status: "empty", data: 0 });
    expect(await readCount(Promise.resolve({ count: null }))).toMatchObject({ status: "error", data: null });
    expect(await readCount(Promise.resolve({ count: 0, error: { code: "57014" } }))).toMatchObject({ status: "error", data: null });
  });
  it("does not expose private errors or rejected request messages", async () => {
    const result = await readQuery(Promise.reject(new Error("https://provider/?api-key=private")));
    expect(result).toEqual({ status: "error", data: null, errorCode: "READ_FAILED" });
    expect(await readQuery(Promise.resolve({ data: null, error: { code: "secret-url" } }))).toEqual(result);
  });
  it("distinguishes missing data from ready records", async () => {
    expect(await readQuery(Promise.resolve({ data: [] }))).toMatchObject({ status: "empty", data: [] });
    expect(await readQuery(Promise.resolve({ data: [1] }))).toMatchObject({ status: "ready", data: [1] });
  });
});
