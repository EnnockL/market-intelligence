import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import { FEE_MODEL_VERSION, INITIAL_POLICIES, PAPER_ENGINE_VERSION, SLIPPAGE_MODEL_VERSION, type PolicyKind } from "@/domain/paper-portfolio";
import { INFORMATION_CUTOFF_POLICY, runSimulationKernel, SIMULATION_ENGINE_VERSION, type SimulationCandidateInput } from "@/domain/simulation";
import { FxRepository } from "@/services/fx/repository";

export interface CreateSimulationRequest { initialCapitalSek:number; startsAt:string; endsAt:string; policy:PolicyKind; entryDelayMs?:number; maxLiquidityParticipationPct?:number; }
export class SimulationService {
  constructor(private db:SupabaseClient) {}
  async run(request:CreateSimulationRequest) {
    const policy={...INITIAL_POLICIES[request.policy],entryDelayMs:request.entryDelayMs??INITIAL_POLICIES[request.policy].entryDelayMs,maxLiquidityParticipationPct:request.maxLiquidityParticipationPct??INITIAL_POLICIES[request.policy].maxLiquidityParticipationPct};
    const {data:rows,error}=await this.db.from("jackpot_candidates").select("id,asset_id,detected_at,current_state,jackpot_candidate_revisions(*),qualification_evaluations(*,qualification_requirements(*))").gte("detected_at",request.startsAt).lte("detected_at",request.endsAt).order("detected_at");
    if(error) throw error;
    const candidates:SimulationCandidateInput[]=[];
    for(const row of rows??[]) {
      const evaluations=[...(row.qualification_evaluations??[])].filter((e:any)=>e.evaluated_at<=request.endsAt).sort((a:any,b:any)=>a.evaluated_at.localeCompare(b.evaluated_at));
      const evaluation=evaluations.at(-1); if(!evaluation) continue;
      const revision=(row.jackpot_candidate_revisions??[]).find((r:any)=>r.revision_number===evaluation.candidate_revision); if(!revision) continue;
      const decisionAvailableAt=[evaluation.evaluated_at,revision.available_at??revision.information_cutoff_at].sort().at(-1)!;
      const requirements=evaluation.qualification_requirements??[], features=revision.features??{};
      const market=evaluation.final_decision==="QUALIFIED"?await this.market(row.asset_id,decisionAvailableAt,request.endsAt):[];
      candidates.push({candidateId:row.id,opportunityId:revision.opportunity_id??null,revisionNumber:revision.revision_number,assetId:row.asset_id,state:evaluation.final_decision,safety:revision.safety_result?.status??"UNKNOWN",dataQuality:num(features.dataQuality),relationshipCoverage:num(features.relationshipCoverage),clusterAdjustedCount:num(features.clusterAdjustedCount),priceMoveBeforeDetectionPct:num(features.priceMoveBeforeDetectionPct),signalAvailableAt:row.detected_at,decisionCutoff:evaluation.information_cutoff_at,decisionAvailableAt,qualificationDecision:evaluation.final_decision,qualificationReason:evaluation.decision_reason,blockerCodes:requirements.filter((x:any)=>x.status!=="PASS"&&x.blocker_code).map((x:any)=>x.blocker_code),market});
    }
    const candidateDatasetHash=deterministicDigest(candidates.map(c=>({id:c.candidateId,revision:c.revisionNumber,decision:c.qualificationDecision,available:c.decisionAvailableAt})));
    const marketDatasetHash=deterministicDigest(candidates.flatMap(c=>c.market.map(m=>m.evidenceId)));
    const inputHash=deterministicDigest({request,policy,candidateDatasetHash,marketDatasetHash,engine:SIMULATION_ENGINE_VERSION});
    const {data:existing}=await this.db.from("simulation_runs").select("id,status").eq("input_hash",inputHash).maybeSingle(); if(existing) return {runId:existing.id,reused:true};
    const {data:run,error:runError}=await this.db.from("simulation_runs").insert({user_id:null,run_scope:"SYSTEM_RESEARCH",strategy:request.policy,status:"running",initial_capital_sek:request.initialCapitalSek,starts_at:request.startsAt,ends_at:request.endsAt,information_cutoff_at:request.startsAt,assumptions:policy,scoring_version:"jackpot-qualification-policy-v2",engine_version:SIMULATION_ENGINE_VERSION,qualification_policy_version:"jackpot-qualification-policy-v2",paper_policy_version:PAPER_ENGINE_VERSION,fee_model_version:FEE_MODEL_VERSION,slippage_model_version:SLIPPAGE_MODEL_VERSION,fx_policy_version:"historical-fx-policy-v1",information_cutoff_policy:INFORMATION_CUTOFF_POLICY,candidate_dataset_hash:candidateDatasetHash,market_dataset_hash:marketDatasetHash,input_hash:inputHash,currency:"SEK"}).select("id").single(); if(runError)throw runError;
    const result=runSimulationKernel({initialCapitalSek:request.initialCapitalSek,startsAt:request.startsAt,endsAt:request.endsAt,policy,candidates});
    const evaluations=result.decisions.map(d=>{const c=candidates.find(x=>x.candidateId===d.candidateId)!;return{simulation_run_id:run.id,candidate_id:c.candidateId,candidate_revision:c.revisionNumber,policy_version:PAPER_ENGINE_VERSION,information_cutoff_at:c.decisionCutoff,status:d.status,reason:d.reason,blocker_codes:c.blockerCodes,known_inputs:{safety:c.safety,dataQuality:c.dataQuality},evidence_refs:d.evidenceIds,input_hash:deterministicDigest({run:run.id,candidate:c.candidateId,policy:PAPER_ENGINE_VERSION})}});
    if(evaluations.length){const{error:e}=await this.db.from("simulation_candidate_evaluations").insert(evaluations);if(e)throw e;}
    const{error:resError}=await this.db.from("simulation_results").insert({simulation_run_id:run.id,final_value_sek:result.finalEquitySek,return_percent:result.returnPct,trade_count:result.tradeCount,winning_trades:result.winningTrades,losing_trades:result.losingTrades,max_drawdown_percent:result.maxDrawdownPct,profit_factor:result.profitFactor,data_status:result.dataStatus,fees_sek:result.feesSek,slippage_sek:result.slippageSek,diagnostics:{blockerFrequency:result.blockerFrequency,decisions:result.decisions.length},attribution:{policy:request.policy}});if(resError)throw resError;
    const{error:benchmarkError}=await this.db.from("simulation_benchmarks").insert(["sp500","nasdaq","bitcoin","cash"].map(benchmark=>benchmark==="cash"?{simulation_run_id:run.id,benchmark,final_value_sek:request.initialCapitalSek,return_percent:0,data_status:"AVAILABLE",reason:null}:{simulation_run_id:run.id,benchmark,final_value_sek:null,return_percent:null,data_status:"INSUFFICIENT_DATA",reason:"NO_POINT_IN_TIME_BENCHMARK_DATA"}));if(benchmarkError)throw benchmarkError;
    await this.db.from("simulation_runs").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",run.id);
    return {runId:run.id,reused:false,result};
  }
  private async market(assetId:string,from:string,to:string){const{data,error}=await this.db.from("crypto_market_observations").select("id,observed_at,ingested_at,price_usd,liquidity_usd").eq("asset_id",assetId).gte("observed_at",from).lte("observed_at",to).lte("ingested_at",to).order("observed_at");if(error)throw error;const fx=new FxRepository(this.db),out=[];for(const x of data??[]){if(num(x.price_usd)===null)continue;const availableAt=[x.observed_at,x.ingested_at].sort().at(-1)!;const rate=await fx.lookup("USD","SEK",x.observed_at,availableAt);if(rate.status!=="FOUND"||!rate.observation)continue;out.push({observedAt:x.observed_at,availableAt,priceSek:Number(x.price_usd)*rate.observation.rate,liquiditySek:num(x.liquidity_usd)===null?null:Number(x.liquidity_usd)*rate.observation.rate,evidenceId:x.id});}return out;}
}
function num(v:unknown){const n=Number(v);return v===null||v===undefined||!Number.isFinite(n)?null:n;}
