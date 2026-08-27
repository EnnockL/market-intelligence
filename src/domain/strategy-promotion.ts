import { deterministicDigest } from "./events";
import type { ValidationPhase } from "./strategy-validation";
import type { RuntimeState } from "./runtime-governance";

export const STRATEGY_PROMOTION_POLICY_VERSION = "strategy-promotion-policy-v1";
export const PROMOTION_PHASES: ValidationPhase[] = ["LEARNING", "FROZEN", "OUT_OF_SAMPLE", "DEMO_VALIDATION"];

export type PromotionDecision = "PROMOTE" | "HOLD" | "REVALIDATE" | "REJECT";
export interface PromotionValidation { id:string; phase:ValidationPhase; decision:"APPROVED"|"REJECTED"|"INSUFFICIENT_DATA"; availableAt:string }

export function evaluateStrategyPromotion(input:{strategyDefinitionId:string;hypothesisId:string;currentState:RuntimeState;cutoffAt:string;validations:PromotionValidation[]}) {
  const usable=input.validations.filter(x=>x.availableAt<=input.cutoffAt);
  const latest=new Map<ValidationPhase,PromotionValidation>();
  for(const phase of PROMOTION_PHASES){const rows=usable.filter(x=>x.phase===phase).sort((a,b)=>a.availableAt.localeCompare(b.availableAt)||a.id.localeCompare(b.id));if(rows.length)latest.set(phase,rows.at(-1)!)}
  const statePhase:Partial<Record<RuntimeState,ValidationPhase>>={RESEARCH:"LEARNING",FROZEN:"FROZEN",OUT_OF_SAMPLE:"OUT_OF_SAMPLE",DEMO_VALIDATION:"DEMO_VALIDATION"};
  const required=statePhase[input.currentState];
  let decision:PromotionDecision="HOLD",targetState:RuntimeState|null=null,blockers:string[]=[];
  if(!required){
    blockers=input.currentState==="APPROVED_SHADOW"?["SHADOW_VALIDATION_ACTIVE"]:["STATE_NOT_PROMOTABLE"];
  } else {
    const position=PROMOTION_PHASES.indexOf(required), prior=PROMOTION_PHASES.slice(0,position);
    const missingPrior=prior.find(p=>latest.get(p)?.decision!=="APPROVED");
    const record=latest.get(required);
    if(missingPrior) blockers=[`PREVIOUS_PHASE_NOT_APPROVED:${missingPrior}`];
    else if(!record) blockers=[`VALIDATION_MISSING:${required}`];
    else if(record.decision==="INSUFFICIENT_DATA") blockers=[`INSUFFICIENT_DATA:${required}`];
    else if(record.decision==="REJECTED"){decision="REJECT";targetState="REJECTED";blockers=[`VALIDATION_REJECTED:${required}`]}
    else {decision="PROMOTE";targetState=position===3?"APPROVED_SHADOW":(["FROZEN","OUT_OF_SAMPLE","DEMO_VALIDATION"] as RuntimeState[])[position];}
  }
  const evidenceRefs=usable.map(x=>({table:"strategy_validation_runs",id:x.id,availableAt:x.availableAt})).sort((a,b)=>a.id.localeCompare(b.id));
  const body={policyVersion:STRATEGY_PROMOTION_POLICY_VERSION,currentState:input.currentState,decision,targetState,requiredPhase:required??null,blockers,evidenceRefs,cutoffAt:input.cutoffAt};
  return {...body,evaluationKey:`promotion_${deterministicDigest({strategyDefinitionId:input.strategyDefinitionId,hypothesisId:input.hypothesisId,...body}).slice(0,40)}`,resultHash:deterministicDigest(body)};
}
