import { deterministicDigest } from "./events";
export const STRATEGY_SIGNAL_PRODUCER_VERSION = "strategy-signal-producer-v1",
  STRATEGY_SHADOW_VERSION = "strategy-shadow-execution-v1";
export type RuntimeSignalDecision =
  "SIGNAL_CREATED" | "NO_TRADE" | "INSUFFICIENT_DATA";
export function signalDecision(input: {
  runtimeDecision: string;
  validationDecision: string;
  setup: {
    side: "LONG" | "SHORT";
    entry: number;
    stop: number;
    target: number;
    setupAt: string;
    evidenceRefs: string[];
  } | null;
  cutoffAt: string;
}) {
  const blockers: string[] = [];
  if (input.runtimeDecision !== "SHADOW_ONLY")
    blockers.push("RUNTIME_NOT_SHADOW_ELIGIBLE");
  if (input.validationDecision !== "APPROVED")
    blockers.push("VALIDATION_NOT_APPROVED");
  if (!input.setup) blockers.push("NO_SETUP_PRESENT");
  if (input.setup && input.setup.setupAt > input.cutoffAt)
    throw new Error("FUTURE_STRATEGY_SETUP_REJECTED");
  const decision: RuntimeSignalDecision = blockers.length
    ? "NO_TRADE"
    : input.setup
      ? "SIGNAL_CREATED"
      : "INSUFFICIENT_DATA";
  const result = {
    version: STRATEGY_SIGNAL_PRODUCER_VERSION,
    decision,
    blockers,
    setup: input.setup,
  };
  return { ...result, resultHash: deterministicDigest(result) };
}
export function shadowOpen(input: {
  signalId: string;
  side: "LONG" | "SHORT";
  entry: number;
  feeBps: number;
  slippageBps: number;
  stressSlippageBps: number;
  cutoffAt: string;
}) {
  const direction = input.side === "LONG" ? 1 : -1,
    modeledEntry =
      input.entry *
      (1 + (direction * (input.feeBps + input.slippageBps)) / 10000),
    stressEntry =
      input.entry *
      (1 + (direction * (input.feeBps + input.stressSlippageBps)) / 10000);
  const result = {
    version: STRATEGY_SHADOW_VERSION,
    state: "OPEN" as const,
    modeledEntry,
    stressEntry,
    feesBps: input.feeBps,
    slippageBps: input.slippageBps,
    stressSlippageBps: input.stressSlippageBps,
    cutoffAt: input.cutoffAt,
  };
  return { ...result, resultHash: deterministicDigest(result) };
}
export function resolveShadowClose(input: {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  modeledEntry: number;
  stressEntry: number;
  high: number;
  low: number;
  close: number;
  expired: boolean;
}) {
  const stopHit =
      input.side === "LONG"
        ? input.low <= input.stop
        : input.high >= input.stop,
    targetHit =
      input.side === "LONG"
        ? input.high >= input.target
        : input.low <= input.target;
  if (!stopHit && !targetHit && !input.expired) return null;
  return closeAt(
    input,
    stopHit ? input.stop : targetHit ? input.target : input.close,
    stopHit ? "STOP" : targetHit ? "TARGET" : "TIME_EXIT",
  );
}
function closeAt(
  input: {
    side: "LONG" | "SHORT";
    entry: number;
    stop: number;
    modeledEntry: number;
    stressEntry: number;
  },
  exit: number,
  reason: string,
) {
  const direction = input.side === "LONG" ? 1 : -1,
    risk = Math.abs(input.entry - input.stop);
  const result = {
    version: STRATEGY_SHADOW_VERSION,
    state: "CLOSED" as const,
    exitPrice: exit,
    exitReason: reason,
    modeledR: risk ? (direction * (exit - input.modeledEntry)) / risk : null,
    stressR: risk ? (direction * (exit - input.stressEntry)) / risk : null,
  };
  return { ...result, resultHash: deterministicDigest(result) };
}
