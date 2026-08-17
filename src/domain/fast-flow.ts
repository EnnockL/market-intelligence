import type { OpportunityState } from "./opportunities";

export const FAST_FLOW_POLICY = { version: "fast-flow-v1", windowSeconds: 15, minimumVerifiedWallets: 3, minimumWalletDataQuality: 80,
  minimumLiquidityUsd: 25_000, minimumLiquidityQuality: 80, minimumRiskQuality: 80, minimumRelationshipConfidence: 80 } as const;
export interface VerifiedBuy { eventId: string; eventEvidenceId: string; assetId: string; walletId: string; occurredAt: string; availableAt: string; verificationEvidenceId: string; dataQuality: number; }
export interface IndependenceEvidence { status: "confirmed" | "related" | "unknown"; evidenceIds: string[]; relationshipTypes: string[]; dataQuality: number; }
export interface FastSafetyEvidence { liquidityUsd: number | null; liquidityQuality: number; liquidityEvidenceId: string | null; riskStatus: "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "CONFIRMED_RUG" | "UNKNOWN"; riskQuality: number; riskEvidenceId: string | null; authorityCoverage: "complete" | "partial" | "unknown"; }
export interface FastFlowEvaluation { state: OpportunityState; blockers: string[]; walletIds: string[]; eventIds: string[]; evidenceIds: string[]; detectedAt: string; informationCutoffAt: string; opportunityScore: number; riskScore: number | null; dataQuality: number; safetyResult: Record<string, unknown>; }

export function findVerifiedConvergence(events: VerifiedBuy[]) {
  const byAsset = new Map<string, VerifiedBuy[]>(); for (const event of events) byAsset.set(event.assetId, [...(byAsset.get(event.assetId) ?? []), event]);
  const clusters: VerifiedBuy[][] = [];
  for (const items of byAsset.values()) { const ordered = [...items].sort(orderEvents); for (let index=0;index<ordered.length;index+=1) {
    const cutoff = new Date(new Date(ordered[index].occurredAt).getTime()+FAST_FLOW_POLICY.windowSeconds*1000).toISOString(); const unique = new Map<string,VerifiedBuy>();
    for (const item of ordered) if(item.occurredAt>=ordered[index].occurredAt&&item.occurredAt<=cutoff&&item.dataQuality>=FAST_FLOW_POLICY.minimumWalletDataQuality&&!unique.has(item.walletId)) unique.set(item.walletId,item);
    if(unique.size>=FAST_FLOW_POLICY.minimumVerifiedWallets){clusters.push([...unique.values()].sort(orderEvents));break;}
  }} return clusters;
}
export function evaluateFastFlow(cluster: VerifiedBuy[], independence: IndependenceEvidence, safety: FastSafetyEvidence): FastFlowEvaluation {
  if(new Set(cluster.map(item=>item.walletId)).size<FAST_FLOW_POLICY.minimumVerifiedWallets) throw new Error("Fast Flow requires three independent wallet observations");
  const blockers:string[]=[]; let state:OpportunityState="fast_opportunity";
  if(independence.status==="related"){blockers.push(...independence.relationshipTypes.map(type=>`wallet_relationship:${type}`));state="rejected";}
  if(["HIGH_RISK","CONFIRMED_RUG"].includes(safety.riskStatus)){blockers.push(`token_risk:${safety.riskStatus}`);state="rejected";}
  if(safety.liquidityUsd!==null&&safety.liquidityUsd<FAST_FLOW_POLICY.minimumLiquidityUsd){blockers.push("liquidity_below_minimum");state="rejected";}
  if(independence.status==="unknown")blockers.push("wallet_independence_unknown");
  if(safety.liquidityUsd===null)blockers.push("liquidity_unknown");
  if(safety.liquidityQuality<FAST_FLOW_POLICY.minimumLiquidityQuality)blockers.push("liquidity_quality_below_minimum");
  if(safety.riskStatus==="UNKNOWN")blockers.push("token_risk_unknown");
  if(safety.riskQuality<FAST_FLOW_POLICY.minimumRiskQuality)blockers.push("token_risk_quality_below_minimum");
  if(safety.authorityCoverage!=="complete")blockers.push("authority_evidence_incomplete");
  if(state!=="rejected"&&blockers.length)state="enriching";
  const qualities=[Math.min(...cluster.map(item=>item.dataQuality)),independence.dataQuality,safety.liquidityQuality,safety.riskQuality];
  const dataQuality=Math.round(qualities.reduce((sum,value)=>sum+value,0)/qualities.length); const riskScore=safety.riskStatus==="UNKNOWN"?null:({LOW_RISK:10,ELEVATED:45,HIGH_RISK:80,CONFIRMED_RUG:100} as const)[safety.riskStatus];
  const eventIds=cluster.map(item=>item.eventId).sort(); const walletIds=cluster.map(item=>item.walletId).sort(); const evidenceIds=[...cluster.flatMap(item=>[item.eventEvidenceId,item.verificationEvidenceId]),...independence.evidenceIds,...[safety.liquidityEvidenceId,safety.riskEvidenceId].filter((id):id is string=>Boolean(id))].sort();
  return {state,blockers,walletIds,eventIds,evidenceIds,detectedAt:cluster[0].occurredAt,informationCutoffAt:cluster.map(item=>item.availableAt).sort().at(-1)!,opportunityScore:state==="fast_opportunity"?Math.min(95,70+walletIds.length*5):0,riskScore,dataQuality,
    safetyResult:{policyVersion:FAST_FLOW_POLICY.version,independence:independence.status,liquidityUsd:safety.liquidityUsd,riskStatus:safety.riskStatus,authorityCoverage:safety.authorityCoverage,blockers}};
}
function orderEvents(a:VerifiedBuy,b:VerifiedBuy){return a.occurredAt.localeCompare(b.occurredAt)||a.walletId.localeCompare(b.walletId)||a.eventId.localeCompare(b.eventId);}
