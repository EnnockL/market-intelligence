import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rethrow: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.rethrow }));
import { invokeLabAction } from "@/app/strategy-lab/lab-action-client";

beforeEach(() => vi.resetAllMocks());
describe("lab client action failure boundary", () => {
  it("preserves form data when a response is lost, clears stale run ID and never retries", async () => {
    const action = vi.fn().mockRejectedValue(new Error("PRIVATE_NETWORK_URL"));
    const form = new FormData(); form.set("startsAt", "2026-01-01"); form.set("endsAt", "2026-01-31");
    const result = await invokeLabAction(action, { status: "SUCCESS", message: "old", runId: "old-run" }, form);
    expect(result).toMatchObject({ status: "ERROR", values: { startsAt: "2026-01-01", endsAt: "2026-01-31" } });
    expect(result.runId).toBeUndefined(); expect(result.message).toContain("kan ha hunnit sparas");
    expect(result.message).not.toContain("PRIVATE"); expect(action).toHaveBeenCalledOnce();
  });
  it("lets Next.js authentication redirects propagate instead of swallowing them", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.rethrow.mockImplementation(error => { throw error; });
    await expect(invokeLabAction(vi.fn().mockRejectedValue(redirect), { status: "IDLE", message: "" }, new FormData())).rejects.toBe(redirect);
    expect(mocks.rethrow).toHaveBeenCalledExactlyOnceWith(redirect);
  });
});
