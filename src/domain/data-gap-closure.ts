import { deterministicDigest } from "@/domain/events";

export const DATA_GAP_CLOSURE_VERSION = "candidate-data-gap-closure-v1";
export type GapStatus = "CLOSED" | "PARTIAL" | "UNKNOWN" | "UNAVAILABLE" | "FAILED";
export interface GapEvidence { id: string; type: string; availableAt: string; source: string; dataQuality: number | null }
export interface GapClosureInput {
  candidateId: string; candidateRevision: number; cutoff: string; previousFeatures: Record<string, unknown>;
  liquidity: { value: number; evidence: GapEvidence } | null;
  risk: { status: string; coverage: number; evidence: GapEvidence } | null;
  verifiedWalletCount: number | null; tokenAgeSeconds: number | null;
  priceAcceleration: GapEvidence | null; volumeAcceleration: GapEvidence | null;
}
export function buildGapClosure(input: GapClosureInput) {
  const features: Record<string, unknown> = { ...input.previousFeatures, liquidity: input.liquidity?.value ?? nullable(input.previousFeatures.liquidity), verifiedWalletCount: input.verifiedWalletCount, tokenAgeSeconds: input.tokenAgeSeconds, riskStatus: input.risk?.status ?? input.previousFeatures.riskStatus ?? "UNKNOWN" };
  const evidence = [input.liquidity?.evidence, input.risk?.evidence, input.priceAcceleration, input.volumeAcceleration].filter(Boolean) as GapEvidence[];
  for (const item of evidence) if (Date.parse(item.availableAt) > Date.parse(input.cutoff)) throw new Error(`FUTURE_EVIDENCE_REJECTED:${item.id}`);
  const qualities = evidence.map(x=>x.dataQuality).filter((x):x is number=>x!==null);
  if (qualities.length) features.dataQuality = Math.round(qualities.reduce((a,b)=>a+b,0)/qualities.length);
  const gaps = {
    safety: input.risk ? "CLOSED" : "UNKNOWN", liquidity: input.liquidity ? "CLOSED" : "UNKNOWN",
    verified_wallet_quality: input.verifiedWalletCount === null ? "UNKNOWN" : "CLOSED",
    token_risk_coverage: input.risk ? input.risk.coverage >= 80 ? "CLOSED" : "PARTIAL" : "UNKNOWN",
    price_acceleration: input.priceAcceleration ? "CLOSED" : "UNKNOWN",
    volume_acceleration: input.volumeAcceleration ? "CLOSED" : "UNKNOWN",
    token_age: input.tokenAgeSeconds === null ? "UNKNOWN" : "CLOSED",
  } satisfies Record<string, GapStatus>;
  return { features, evidence, gaps, closureHash: deterministicDigest({ version: DATA_GAP_CLOSURE_VERSION, candidateId: input.candidateId, features, evidence, gaps }) };
}
function nullable(value: unknown){const n=Number(value);return value===null||value===undefined||!Number.isFinite(n)?null:n}
