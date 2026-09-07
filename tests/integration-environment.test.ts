import { describe, expect, it } from "vitest";
import { integrationTestEnvironment } from "./support/integration-environment";

const isolated = {
  RUN_SUPABASE_INTEGRATION: "1",
  SUPABASE_TEST_ALLOW_WRITES: "1",
  SUPABASE_TEST_URL: "https://test-isolated.supabase.co",
  SUPABASE_TEST_SERVICE_ROLE_KEY: "isolated-fixture-key",
};

describe("integration test isolation", () => {
  it("leaves integration disabled by default", () => expect(integrationTestEnvironment({})).toEqual({}));
  it("refuses application credentials as a fallback", () => {
    expect(() => integrationTestEnvironment({ RUN_SUPABASE_INTEGRATION: "1", SUPABASE_TEST_ALLOW_WRITES: "1", NEXT_PUBLIC_SUPABASE_URL: "https://app.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "app-fixture-key" })).toThrow("explicit SUPABASE_TEST_URL");
  });
  it("requires separate explicit acknowledgement of database writes", () => {
    expect(() => integrationTestEnvironment({ ...isolated, SUPABASE_TEST_ALLOW_WRITES: undefined })).toThrow("SUPABASE_TEST_ALLOW_WRITES");
  });
  it("rejects production project even when renamed test variables and scheme differ", () => {
    expect(() => integrationTestEnvironment(isolated, [{ NEXT_PUBLIC_SUPABASE_URL: "http://test-isolated.supabase.co/" }])).toThrow("must differ");
  });
  it("rejects reused production credentials", () => {
    expect(() => integrationTestEnvironment(isolated, [{ SUPABASE_SERVICE_ROLE_KEY: isolated.SUPABASE_TEST_SERVICE_ROLE_KEY }])).toThrow("credentials must differ");
  });
  it("routes existing integration suites only to explicitly isolated credentials", () => {
    expect(integrationTestEnvironment(isolated, [{ NEXT_PUBLIC_SUPABASE_URL: "https://app.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "app-fixture-key" }])).toEqual({ NEXT_PUBLIC_SUPABASE_URL: isolated.SUPABASE_TEST_URL, SUPABASE_SERVICE_ROLE_KEY: isolated.SUPABASE_TEST_SERVICE_ROLE_KEY });
  });
});
