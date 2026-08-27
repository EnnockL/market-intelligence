import { describe, expect, it } from "vitest";
import {
  resolveShadowClose,
  shadowOpen,
  signalDecision,
} from "@/domain/strategy-runtime-signal";
const setup = {
  side: "LONG" as const,
  entry: 100,
  stop: 99,
  target: 102,
  setupAt: "2026-01-01T10:00:00Z",
  evidenceRefs: ["c1"],
};
describe("strategy runtime signal", () => {
  it("keeps NO_TRADE as default", () =>
    expect(
      signalDecision({
        runtimeDecision: "NO_TRADE",
        validationDecision: "APPROVED",
        setup,
        cutoffAt: "2026-01-01T10:01:00Z",
      }).decision,
    ).toBe("NO_TRADE"));
  it("creates only approved shadow signals", () =>
    expect(
      signalDecision({
        runtimeDecision: "SHADOW_ONLY",
        validationDecision: "APPROVED",
        setup,
        cutoffAt: "2026-01-01T10:01:00Z",
      }).decision,
    ).toBe("SIGNAL_CREATED"));
  it("rejects future setups", () =>
    expect(() =>
      signalDecision({
        runtimeDecision: "SHADOW_ONLY",
        validationDecision: "APPROVED",
        setup,
        cutoffAt: "2026-01-01T09:00:00Z",
      }),
    ).toThrow("FUTURE_STRATEGY_SETUP_REJECTED"));
  it("models costs and closes target deterministically", () => {
    const open = shadowOpen({
      signalId: "s",
      side: "LONG",
      entry: 100,
      feeBps: 10,
      slippageBps: 10,
      stressSlippageBps: 30,
      cutoffAt: "2026-01-01T10:00:00Z",
    });
    const close = resolveShadowClose({
      ...setup,
      modeledEntry: open.modeledEntry,
      stressEntry: open.stressEntry,
      high: 102.2,
      low: 99.5,
      close: 101,
      expired: false,
    });
    expect(close?.exitReason).toBe("TARGET");
    expect(close!.stressR).toBeLessThan(close!.modeledR!);
  });
  it("uses conservative stop when stop and target share a candle", () => {
    const close = resolveShadowClose({
      ...setup,
      modeledEntry: 100,
      stressEntry: 100,
      high: 103,
      low: 98,
      close: 101,
      expired: false,
    });
    expect(close?.exitReason).toBe("STOP");
  });
});
