import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_SESSION_TTL_SECONDS, signOperatorSession } from "@/lib/operator-auth";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), db: vi.fn(() => { throw new Error("DB_EFFECT_REACHED"); }), revalidate: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.db }));

import { runBacktest, syncCandleSource } from "@/app/strategy-lab/actions";
import { registerHypothesis, runValidation } from "@/app/strategy-validation/actions";
import { queueIngestionJob } from "@/app/data-collection/actions";
import { runSimulation } from "@/app/simulation/actions";
import { runReplay } from "@/app/replay/actions";
import { loginOperator, logoutOperator } from "@/app/operator/actions";
import ExecutionPage from "@/app/execution/page";

const token = "test-only-operator-token-with-32-plus-characters";
const idle = { status: "IDLE" as const, message: "" };
const actions = [
  { name: "backtest", invoke: (form: FormData) => runBacktest(idle, form) },
  { name: "candle import", invoke: (form: FormData) => syncCandleSource(idle, form) },
  { name: "hypothesis", invoke: (form: FormData) => registerHypothesis(idle, form) },
  { name: "validation", invoke: (form: FormData) => runValidation(idle, form) },
  { name: "ingestion queue", invoke: (form: FormData) => queueIngestionJob({ status: "idle", message: "" }, form) },
  { name: "simulation", invoke: runSimulation },
  { name: "replay", invoke: runReplay },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATA_OPERATIONS_OPERATOR_TOKEN", token);
  mocks.get.mockReturnValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["missing", "invalid", "expired", "tampered", "unconfigured"])("privileged entry points deny %s sessions before effects", condition => {
  beforeEach(() => {
    if (condition === "unconfigured") vi.stubEnv("DATA_OPERATIONS_OPERATOR_TOKEN", "");
    if (condition === "invalid") mocks.get.mockReturnValue({ value: "not-a-session" });
    if (condition === "expired") mocks.get.mockReturnValue({ value: signOperatorSession(token, Date.now() - (OPERATOR_SESSION_TTL_SECONDS + 1) * 1000) });
    if (condition === "tampered") mocks.get.mockReturnValue({ value: `${signOperatorSession(token)}x` });
  });
  it.each(actions)("guards $name before reading form values or reaching the database", async ({ invoke }) => {
    const form = new FormData(), read = vi.spyOn(form, "get");
    await expect(invoke(form)).rejects.toThrow("REDIRECT:/operator?next=");
    expect(read).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("protects the execution page before its private queries", async () => {
    await expect(ExecutionPage()).rejects.toThrow("REDIRECT:/operator?next=%2Fexecution");
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

describe("operator login and authorized request", () => {
  it("does not mint a session for invalid tokens or missing configuration", async () => {
    const form = new FormData(); form.set("operatorToken", "wrong");
    expect((await loginOperator(idle, form)).status).toBe("ERROR");
    vi.stubEnv("DATA_OPERATIONS_OPERATOR_TOKEN", "");
    form.set("operatorToken", token);
    expect((await loginOperator(idle, form)).status).toBe("ERROR");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("mints only on correct login and rejects external redirects", async () => {
    const form = new FormData(); form.set("operatorToken", token); form.set("next", "https://example.com");
    await expect(loginOperator(idle, form)).rejects.toThrow("REDIRECT:/");
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("allows an authenticated request through the guard without treating a raw token as a session", async () => {
    mocks.get.mockReturnValue({ value: signOperatorSession(token) });
    await expect(ExecutionPage()).rejects.toThrow("DB_EFFECT_REACHED");
    expect(mocks.db).toHaveBeenCalledOnce();
  });
  it("logout is cookie-only and never calls a provider/database", async () => {
    await expect(logoutOperator()).rejects.toThrow("REDIRECT:/operator");
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), "", expect.objectContaining({ maxAge: 0 }));
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
