import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateStrategyPromotion, STRATEGY_PROMOTION_POLICY_VERSION } from "@/domain/strategy-promotion";
import type { RuntimeState } from "@/domain/runtime-governance";
import { deterministicDigest } from "@/domain/events";

export class StrategyPromotionService{
 constructor(private db:SupabaseClient){}
 async run(cutoffAt=new Date().toISOString()){
  const hypotheses=await this.db.from("strategy_hypotheses").select("id,strategy_definition_id").lte("available_at",cutoffAt).order("registered_at");if(hypotheses.error)throw hypotheses.error;
  let promoted=0,held=0,rejected=0,reused=0;
  for(const h of hypotheses.data??[]){
   const [validations,lifecycle]=await Promise.all([
    this.db.from("strategy_validation_runs").select("id,phase,decision,available_at").eq("strategy_definition_id",h.strategy_definition_id).eq("hypothesis_id",h.id).lte("available_at",cutoffAt).order("available_at"),
    this.db.from("strategy_lifecycle_revisions").select("id,revision_number,state,available_at").eq("strategy_definition_id",h.strategy_definition_id).eq("hypothesis_id",h.id).lte("available_at",cutoffAt).order("revision_number",{ascending:false}).limit(1).maybeSingle()
   ]);if(validations.error)throw validations.error;if(lifecycle.error)throw lifecycle.error;
   const currentState=(lifecycle.data?.state??"RESEARCH") as RuntimeState;
   const result=evaluateStrategyPromotion({strategyDefinitionId:h.strategy_definition_id,hypothesisId:h.id,currentState,cutoffAt,validations:(validations.data??[]).map((x:any)=>({id:x.id,phase:x.phase,decision:x.decision,availableAt:x.available_at}))});
   const saved=await this.db.from("strategy_promotion_evaluations").upsert({evaluation_key:result.evaluationKey,policy_version:STRATEGY_PROMOTION_POLICY_VERSION,strategy_definition_id:h.strategy_definition_id,hypothesis_id:h.id,from_state:currentState,target_state:result.targetState,decision:result.decision,required_phase:result.requiredPhase,blockers:result.blockers,evidence_refs:result.evidenceRefs,information_cutoff_at:cutoffAt,available_at:cutoffAt,result_hash:result.resultHash},{onConflict:"evaluation_key",ignoreDuplicates:true}).select("id").maybeSingle();if(saved.error)throw saved.error;
   if(!saved.data)reused++;
   if(result.decision==="PROMOTE"||result.decision==="REJECT"){
    const next=result.targetState!;const revision=(lifecycle.data?.revision_number??0)+1;const revisionKey=`lifecycle_${deterministicDigest({strategyDefinitionId:h.strategy_definition_id,hypothesisId:h.id,revision,state:next,evaluationKey:result.evaluationKey}).slice(0,40)}`;
    const row=await this.db.from("strategy_lifecycle_revisions").upsert({revision_key:revisionKey,policy_version:STRATEGY_PROMOTION_POLICY_VERSION,strategy_definition_id:h.strategy_definition_id,hypothesis_id:h.id,revision_number:revision,state:next,previous_revision_id:lifecycle.data?.id??null,promotion_evaluation_id:saved.data?.id??null,evidence_refs:result.evidenceRefs,information_cutoff_at:cutoffAt,available_at:cutoffAt,result_hash:deterministicDigest({revisionKey,next,resultHash:result.resultHash})},{onConflict:"revision_key",ignoreDuplicates:true});if(row.error)throw row.error;
    if(result.decision==="PROMOTE")promoted++;else rejected++;
   }else held++;
  }
  return {evaluated:hypotheses.data?.length??0,promoted,held,rejected,reused};
 }
}
