import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOperatorSession, OPERATOR_SESSION_TTL_SECONDS } from "@/lib/operator-auth";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), cookies: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { createOperatorSession, deleteOperatorSession, getOperatorSession, isOperatorAuthConfigured, OPERATOR_SESSION_COOKIE, requireOperatorPage, requireOperatorSession } from "@/lib/operator-session";

const token = "test-only-operator-token-with-32-plus-characters";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATA_OPERATIONS_OPERATOR_TOKEN", token);
  mocks.cookies.mockResolvedValue({ get: mocks.get, set: mocks.set });
  mocks.get.mockReturnValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("operator request session", () => {
  it("fails closed before reading cookies when auth is unconfigured", async () => {
    vi.stubEnv("DATA_OPERATIONS_OPERATOR_TOKEN", "");
    expect(isOperatorAuthConfigured()).toBe(false);
    expect(await getOperatorSession()).toBeNull();
    await expect(createOperatorSession()).rejects.toThrow("not configured");
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("denies missing cookies and redirects protected pages", async () => {
    await expect(requireOperatorSession()).rejects.toThrow("/operator");
    await expect(requireOperatorPage("/execution")).rejects.toThrow("REDIRECT:/operator?next=%2Fexecution");
  });
  it("accepts a verified cookie", async () => {
    mocks.get.mockReturnValue({ value: signOperatorSession(token) });
    expect(await requireOperatorSession()).toHaveProperty("expiresAt");
    expect(await requireOperatorPage("/execution")).toHaveProperty("expiresAt");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("writes a short-lived Secure HttpOnly strict cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await createOperatorSession();
    expect(mocks.set).toHaveBeenCalledWith(OPERATOR_SESSION_COOKIE, expect.any(String), { httpOnly: true, secure: true, sameSite: "strict", path: "/", priority: "high", maxAge: OPERATOR_SESSION_TTL_SECONDS });
  });
  it("expires the same cookie on logout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await deleteOperatorSession();
    expect(mocks.set).toHaveBeenCalledWith(OPERATOR_SESSION_COOKIE, "", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0, expires: new Date(0) }));
  });
});
