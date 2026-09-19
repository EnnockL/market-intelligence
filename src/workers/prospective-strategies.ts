import type { SupabaseClient } from "@supabase/supabase-js";
import { StrategyPatternLabService } from "@/services/strategy-pattern-lab/service";
import { StrategyIntelligenceService } from "@/services/strategy-intelligence/service";

export async function runDueProspectiveStrategies(db:SupabaseClient,now=new Date().toISOString()){
  const plans=await db.from("strategy_dataset_plans").select("id,strategy_frozen_datasets(id,strategy_evaluation_runs(id))").lte("ends_at",now).order("ends_at").limit(100);
  if(plans.error)throw plans.error;
  let evaluated=0,published=0;
  for(const plan of plans.data??[]){
    const dataset=plan.strategy_frozen_datasets?.[0],existing=dataset?.strategy_evaluation_runs?.[0];
    if(existing){
      const result=await new StrategyIntelligenceService(db).researchEvaluation(existing.id);
      if(!result.reused)published++;
      continue;
    }
    const run=await new StrategyPatternLabService(db).runFrozen(plan.id);
    await new StrategyIntelligenceService(db).researchEvaluation(run.runId);evaluated++;published++;
    if(evaluated>=1)break;
  }
  return{considered:plans.data?.length??0,evaluated,published,ordersSent:0};
}
