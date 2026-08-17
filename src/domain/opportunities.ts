import { deterministicDigest } from "./events";

export const FAST_FLOW_POLICY = {
  version: "fast-flow-policy-v1",
  windowSeconds: 15,
  minimumIndependentWallets: 3,
  minimumWalletDataQuality: 80,
  minimumLiquidityUsd: 25_000,
  minimumLiquidityDataQuality: 80,
  minimumRiskDataQuality: 80,
} as const;

export type OpportunityState = "detected" | "fast_opportunity" | "enriching" | "qualified" | "watch" | "rejected" | "paper_trade_candidate";
export type WalletLifecycle = "candidate" | "reviewing" | "verified";
export type FastFlowRiskStatus = "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "CONFIRMED_RUG" | "UNKNOWN";

export interface FastFlowBuyEvent {
  eventId: string;
  assetId: string;
  walletId: string;
  occurredAt: string;
  availableAt: string;
  walletLifecycle: WalletLifecycle;
  walletDataQuality: number;
}

export interface FastFlowSafetyEvidence {
  liquidityUsd: number | null;
  liquidityDataQuality: number;
  liquidityProvider: string | null;
  liquidityObservedAt: string | null;
  riskStatus: FastFlowRiskStatus;
  riskDataQuality: number;
  riskProvider: string | null;
  riskObservedAt: string | null;
}

export interface FastFlowEvaluation {
  opportunityKey: string;
  revisionKey: string;
  state: OpportunityState;
  assetId: string;
  detectedAt: string;
  lastEvidenceAt: string;
  walletIds: string[];
  eventIds: string[];
  opportunityScore: number;
  riskScore: number | null;
  dataQuality: number;
  blockers: string[];
  evidence: FastFlowSafetyEvidence;
  policyVersion: string;
}

export function findFastFlowClusters(events: FastFlowBuyEvent[], safetyByAsset: Map<string, FastFlowSafetyEvidence>) {
  const eligible = events.filter((event) => event.walletLifecycle === "verified" && event.walletDataQuality >= FAST_FLOW_POLICY.minimumWalletDataQuality);
  const byAsset = new Map<string, FastFlowBuyEvent[]>();
  for (const event of eligible) byAsset.set(event.assetId, [...(byAsset.get(event.assetId) ?? []), event]);
  const results: FastFlowEvaluation[] = [];
  for (const [assetId, items] of byAsset) {
    const ordered = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.walletId.localeCompare(b.walletId) || a.eventId.localeCompare(b.eventId));
    for (let start = 0; start < ordered.length; start += 1) {
      const cutoff = new Date(new Date(ordered[start].occurredAt).getTime() + FAST_FLOW_POLICY.windowSeconds * 1000).toISOString();
      const window = ordered.filter((item) => item.occurredAt >= ordered[start].occurredAt && item.occurredAt <= cutoff);
      const unique = new Map<string, FastFlowBuyEvent>();
      for (const item of window) if (!unique.has(item.walletId)) unique.set(item.walletId, item);
      if (unique.size < FAST_FLOW_POLICY.minimumIndependentWallets) continue;
      results.push(evaluateFastFlow(assetId, [...unique.values()], safetyByAsset.get(assetId) ?? unknownSafety()));
      break;
    }
  }
  return results.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.assetId.localeCompare(b.assetId));
}

export function evaluateFastFlow(assetId: string, events: FastFlowBuyEvent[], evidence: FastFlowSafetyEvidence): FastFlowEvaluation {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.walletId.localeCompare(b.walletId));
  const walletIds = [...new Set(ordered.map((item) => item.walletId))].sort();
  const eventIds = ordered.map((item) => item.eventId).sort();
  const blockers: string[] = [];
  let state: OpportunityState = "fast_opportunity";
  if (evidence.riskStatus === "CONFIRMED_RUG" || evidence.riskStatus === "HIGH_RISK") {
    blockers.push(`risk_status:${evidence.riskStatus}`);
    state = "rejected";
  }
  if (evidence.riskStatus === "UNKNOWN" || evidence.riskDataQuality < FAST_FLOW_POLICY.minimumRiskDataQuality) blockers.push("risk_evidence_incomplete");
  if (evidence.liquidityUsd === null) blockers.push("liquidity_unknown");
  else if (evidence.liquidityUsd < FAST_FLOW_POLICY.minimumLiquidityUsd) blockers.push("liquidity_below_minimum");
  if (evidence.liquidityDataQuality < FAST_FLOW_POLICY.minimumLiquidityDataQuality) blockers.push("liquidity_quality_below_minimum");
  if (state !== "rejected" && blockers.length) state = "enriching";
  const knownQuality = [Math.min(...ordered.map((item) => item.walletDataQuality)), evidence.liquidityDataQuality, evidence.riskDataQuality];
  const dataQuality = Math.round(knownQuality.reduce((sum, value) => sum + value, 0) / knownQuality.length);
  const riskScore = evidence.riskStatus === "UNKNOWN" ? null : ({ LOW_RISK: 15, ELEVATED: 45, HIGH_RISK: 80, CONFIRMED_RUG: 100 } as const)[evidence.riskStatus];
  const opportunityScore = Math.min(95, 55 + walletIds.length * 8 + (evidence.liquidityUsd !== null && evidence.liquidityUsd >= FAST_FLOW_POLICY.minimumLiquidityUsd ? 8 : 0));
  const detectedAt = ordered[0].occurredAt;
  const lastEvidenceAt = ordered.map((item) => item.availableAt).sort().at(-1) ?? detectedAt;
  const opportunityKey = `fast-flow:${FAST_FLOW_POLICY.version}:${assetId}:${ordered[0].eventId}`;
  const revisionPayload = { state, walletIds, eventIds, evidence, blockers, opportunityScore, riskScore, dataQuality };
  return { opportunityKey, revisionKey: deterministicDigest(revisionPayload), state, assetId, detectedAt, lastEvidenceAt, walletIds, eventIds, opportunityScore, riskScore, dataQuality, blockers, evidence, policyVersion: FAST_FLOW_POLICY.version };
}

function unknownSafety(): FastFlowSafetyEvidence {
  return { liquidityUsd: null, liquidityDataQuality: 0, liquidityProvider: null, liquidityObservedAt: null, riskStatus: "UNKNOWN", riskDataQuality: 0, riskProvider: null, riskObservedAt: null };
}
