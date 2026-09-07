import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), formProps: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.db }));
vi.mock("@/lib/operator-session", () => ({ isOperatorAuthConfigured: () => true }));
vi.mock("@/app/data-collection/manual-run-form", () => ({ ManualRunForm: (props: unknown) => { mocks.formProps(props); return null; } }));
import DataCollectionPage from "@/app/data-collection/page";

type Response = { data?: unknown; count?: number | null; error?: unknown };
function database(responses: Record<string, Response | Error> = {}) {
  const query = (table: string) => {
    let count = false;
    const chain: any = {
      select: (_: string, options?: { head?: boolean }) => { count = !!options?.head; return chain; },
      order: () => chain, limit: () => chain, gte: () => chain, lt: () => chain,
      then: (resolve: (result: Response) => unknown, reject: (error: unknown) => unknown) => {
        const value = responses[table] ?? (count ? { count: 0 } : { data: [] });
        return (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from: query, rpc: query };
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("public operations read boundary", () => {
  it("renders successful panels even when other requests reject or report database errors", async () => {
    mocks.db.mockReturnValue(database({
      scheduled_jobs: new Error("PRIVATE_NETWORK_DETAILS"),
      data_operations_window_summary: { data: null, error: { message: "PRIVATE_DATABASE_DETAILS" } },
      market_prices: { count: 123 }, market_candles: { count: null },
    }));
    const html = renderToStaticMarkup(await DataCollectionPage());
    expect(html).toContain("123");
    expect(html).toContain("Schemaläggningen kunde inte laddas");
    expect(html).toContain("Dygnsaggregatet kunde inte laddas");
    expect(html).toContain("En eller flera dataräknare kunde inte laddas");
    expect(html).not.toContain("PRIVATE_");
  });

  it("does not serialize private worker metrics and errors into the client form", async () => {
    mocks.db.mockReturnValue(database({ scheduled_jobs: { data: [{
      id: "job", job_key: "stock-ingestion", job_type: "STOCK_INGESTION", enabled: true,
      status: "HEALTHY", interval_seconds: 300, next_run_at: new Date().toISOString(),
      last_successful_run_at: null, last_heartbeat_at: null, consecutive_failures: 0,
      last_error: "PRIVATE_ACCOUNT_PAYLOAD", metrics: { records: 0, payload: "PRIVATE_ACCOUNT_PAYLOAD" },
    }] } }));
    const html = renderToStaticMarkup(await DataCollectionPage());
    expect(mocks.formProps).toHaveBeenCalledWith({ jobs: [{ job_key: "stock-ingestion", job_type: "STOCK_INGESTION" }], enabled: true });
    expect(html).not.toContain("PRIVATE_ACCOUNT_PAYLOAD");
    expect(html).toContain("UNAVAILABLE");
  });

  it("shows genuine empty reads without reporting a network failure", async () => {
    mocks.db.mockReturnValue(database());
    const html = renderToStaticMarkup(await DataCollectionPage());
    expect(html).toContain("0/0");
    expect(html).not.toContain('role="alert"');
  });
});
