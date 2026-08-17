import { describe, expect, it } from "vitest";
import { evaluateFastFlow, findFastFlowClusters, type FastFlowBuyEvent, type FastFlowSafetyEvidence } from "@/domain/opportunities";
import { walletTradeEventKey } from "@/domain/events";

const safety: FastFlowSafetyEvidence = { liquidityUsd: 100_000, liquidityDataQuality: 90, liquidityProvider: "test", liquidityObservedAt: "2026-01-01T00:00:05.000Z", riskStatus: "LOW_RISK", riskDataQuality: 90, riskProvider: "test", riskObservedAt: "2026-01-01T00:00:05.000Z" };
const event = (id: string, wallet: string, second: number, lifecycle: FastFlowBuyEvent["walletLifecycle"] = "verified"): FastFlowBuyEvent => ({ eventId: id, assetId: "asset-1", walletId: wallet, occurredAt: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`, availableAt: `2026-01-01T00:00:${String(second).padStart(2, "0")}.500Z`, walletLifecycle: lifecycle, walletDataQuality: 90 });

describe("Fast Flow", () => {
  it("uses stable wallet transaction identity for duplicate prevention", () => {
    expect(walletTradeEventKey({ walletId: "wallet", transactionHash: "signature", instructionIndex: 2 })).toBe("wallet-trade:wallet:signature:2");
  });
  it("detects three independent verified wallets inside the window", () => {
    const results = findFastFlowClusters([event("e1", "w1", 1), event("e2", "w2", 4), event("e3", "w3", 12)], new Map([["asset-1", safety]]));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ state: "fast_opportunity", walletIds: ["w1", "w2", "w3"], blockers: [] });
  });

  it("does not count duplicate or unverified wallets", () => {
    const results = findFastFlowClusters([event("e1", "w1", 1), event("e2", "w1", 2), event("e3", "w2", 3), event("e4", "w3", 4, "reviewing")], new Map([["asset-1", safety]]));
    expect(results).toEqual([]);
  });

  it("keeps missing evidence unknown and enriching", () => {
    const result = evaluateFastFlow("asset-1", [event("e1", "w1", 1), event("e2", "w2", 2), event("e3", "w3", 3)], { ...safety, liquidityUsd: null, liquidityDataQuality: 0, riskStatus: "UNKNOWN", riskDataQuality: 0 });
    expect(result.state).toBe("enriching");
    expect(result.riskScore).toBeNull();
    expect(result.blockers).toContain("liquidity_unknown");
  });

  it("vetoes high risk and produces deterministic revision identity", () => {
    const events = [event("e1", "w1", 1), event("e2", "w2", 2), event("e3", "w3", 3)];
    const first = evaluateFastFlow("asset-1", events, { ...safety, riskStatus: "CONFIRMED_RUG" });
    const second = evaluateFastFlow("asset-1", [...events].reverse(), { ...safety, riskStatus: "CONFIRMED_RUG" });
    expect(first.state).toBe("rejected");
    expect(first.revisionKey).toBe(second.revisionKey);
  });
});
