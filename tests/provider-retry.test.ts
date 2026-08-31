import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../src/services/providers/fetch-with-retry";

describe("provider fetch recovery", () => {
  it("retries a transient 503 and returns the recovered response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async () => undefined);

    const response = await fetchWithRetry(fetcher, { sleep, random: () => 0 });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not retry authorization or rate-limit responses", async () => {
    for (const status of [401, 403, 429]) {
      const fetcher = vi.fn(async () => new Response("blocked", { status }));
      const response = await fetchWithRetry(fetcher, { sleep: async () => undefined });
      expect(response.status).toBe(status);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("stops after the bounded number of attempts", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const response = await fetchWithRetry(fetcher, { maxAttempts: 3, sleep: async () => undefined, random: () => 0 });
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
