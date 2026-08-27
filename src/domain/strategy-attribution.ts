import { deterministicDigest } from "./events";
export const STRATEGY_ATTRIBUTION_CONTRACT_VERSION = "strategy-attribution-v1";
export interface StrategyAttributionInput { strategyDefinitionId:string|null;strategyVersion:number|null;validationRunId:string|null;runtimeAssessmentId:string|null;informationCutoffAt:string;availableAt:string }
export function createStrategyAttribution(input:StrategyAttributionInput){
 if(Date.parse(input.availableAt)>Date.parse(input.informationCutoffAt))throw new Error("FUTURE_STRATEGY_ATTRIBUTION_REJECTED");
 const identity=[input.strategyDefinitionId,input.strategyVersion,input.validationRunId],present=identity.filter(v=>v!==null).length;
 if(present!==0&&present!==identity.length)throw new Error("PARTIAL_STRATEGY_ATTRIBUTION_REJECTED");
 const status=present===identity.length?"KNOWN" as const:"UNKNOWN" as const;
 if(status==="UNKNOWN"&&input.runtimeAssessmentId!==null)throw new Error("ORPHAN_RUNTIME_ASSESSMENT_REJECTED");
 const normalized={...input,status,contractVersion:STRATEGY_ATTRIBUTION_CONTRACT_VERSION};
 return{...normalized,attributionKey:`strategy_attr_${deterministicDigest(normalized).slice(0,40)}`,payloadHash:deterministicDigest(normalized)};
}
