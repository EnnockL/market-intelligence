import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest, createEventEnvelope } from "@/domain/events";
import { EXPERT_KNOWLEDGE_VERSION, retrieveKnowledge, type EvidenceLevel, type KnowledgeDomain, type KnowledgeQuery, type KnowledgeRule, type KnowledgeType } from "@/domain/expert-knowledge";
import { PostgresOutboxTransport } from "@/services/events/postgres-outbox-transport";

const ACCESSED_AT="2026-08-18T00:00:00.000Z";
const SOURCES=[
 {key:"investor-gov-diversification",title:"Asset Allocation and Diversification",publisher:"U.S. Securities and Exchange Commission",url:"https://www.investor.gov/introduction-investing/getting-started/asset-allocation",type:"REGULATORY_GUIDANCE",level:"REGULATORY"},
 {key:"finra-order-types",title:"Order Types",publisher:"FINRA",url:"https://www.finra.org/investors/investing/investment-products/stocks/order-types",type:"REGULATORY_GUIDANCE",level:"REGULATORY"},
 {key:"sec-crypto-disclosures",title:"Offerings and Registrations of Securities in the Crypto Asset Markets",publisher:"U.S. Securities and Exchange Commission",url:"https://www.sec.gov/newsroom/speeches-statements/cf-crypto-securities-041025-offerings-registrations-securities-crypto-asset-markets",type:"REGULATORY_GUIDANCE",level:"REGULATORY"},
 {key:"fed-model-risk",title:"Supervisory Guidance on Model Risk Management",publisher:"Federal Reserve",url:"https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm",type:"REGULATORY_GUIDANCE",level:"REGULATORY"},
 {key:"fed-counterparty-distribution",title:"Interagency Supervisory Guidance on Counterparty Credit Risk Management",publisher:"Federal Reserve",url:"https://www.federalreserve.gov/frrs/guidance/interagency-supervisory-guidance-on-counterparty-credit-risk-management.htm",type:"REGULATORY_GUIDANCE",level:"REGULATORY"},
 {key:"nist-ai-rmf",title:"Artificial Intelligence Risk Management Framework 1.0",publisher:"NIST",url:"https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10",type:"STANDARD",level:"REGULATORY"},
] as const;
type SeedRule={key:string;domain:KnowledgeDomain;topic:string;principle:string;type:KnowledgeType;level:EvidenceLevel;agents:string[];required?:string[];exceptions?:string[];tags:string[];sources:string[];conflicts?:string[]};
const RULES:SeedRule[]=[
 {key:"risk.diversification.contextual",domain:"RISK_MANAGEMENT",topic:"diversification",principle:"Evaluate diversification together with time horizon and risk tolerance; diversification reduces concentration but does not eliminate market loss.",type:"FOUNDATION",level:"REGULATORY",agents:["risk","portfolio","meta"],required:["timeHorizon","riskTolerance"],exceptions:["A deliberately concentrated mandate must be labeled and risk-budgeted separately."],tags:["concentration","allocation"],sources:["investor-gov-diversification"]},
 {key:"execution.market-order.price-uncertain",domain:"MICROSTRUCTURE",topic:"order_execution",principle:"A market order prioritizes execution, not a guaranteed execution price; simulations must model price uncertainty, fees and slippage.",type:"FOUNDATION",level:"REGULATORY",agents:["paper-portfolio","simulation","fast-flow"],required:["liquidity"],tags:["execution","slippage"],sources:["finra-order-types"]},
 {key:"crypto.risk.multi-dimensional",domain:"CRYPTO",topic:"token_risk",principle:"Assess crypto opportunities across volatility, liquidity, technology, cybersecurity and legal or regulatory risk; a single risk score must preserve component evidence.",type:"FOUNDATION",level:"REGULATORY",agents:["token-risk","jackpot","meta"],tags:["liquidity","safety","rug-risk"],sources:["sec-crypto-disclosures"]},
 {key:"models.require-outcome-analysis",domain:"QUANTITATIVE",topic:"model_validation",principle:"Model validation requires outcomes analysis, backtesting and ongoing monitoring; apparent in-sample fit is not sufficient evidence of edge.",type:"FOUNDATION",level:"REGULATORY",agents:["forecast","performance","simulation","meta"],tags:["backtest","calibration","out-of-sample"],sources:["fed-model-risk"]},
 {key:"risk.use-distribution-not-point",domain:"RISK_MANAGEMENT",topic:"uncertainty",principle:"Risk assessment should examine the distribution of plausible outcomes and tail behavior rather than rely on one point estimate.",type:"PROFESSIONAL",level:"REGULATORY",agents:["risk","forecast","simulation","portfolio"],tags:["tail-risk","distribution"],sources:["fed-counterparty-distribution"]},
 {key:"governance.traceable-context",domain:"SYSTEM_GOVERNANCE",topic:"traceability",principle:"Automated analysis must preserve source, version, cutoff, limitations and retrieval trace so outputs can be tested and reproduced.",type:"FOUNDATION",level:"REGULATORY",agents:["*"],tags:["point-in-time","audit","reproducibility"],sources:["nist-ai-rmf","fed-model-risk"]},
];

export class ExpertKnowledgeService{
 private transport; constructor(private db:SupabaseClient){this.transport=new PostgresOutboxTransport(db)}
 async seed(){
  const sourceIds=new Map<string,string>();
  for(const source of SOURCES){const existing=await this.db.from("knowledge_sources").select("id").eq("source_key",source.key).maybeSingle();if(existing.error)throw existing.error;let id=existing.data?.id;if(!id){const inserted=await this.db.from("knowledge_sources").insert({source_key:source.key,title:source.title,publisher:source.publisher,source_url:source.url,source_type:source.type,evidence_level:source.level,accessed_at:ACCESSED_AT}).select("id").single();if(inserted.error)throw inserted.error;id=inserted.data.id}sourceIds.set(source.key,id)}
  let inserted=0;
  for(const rule of RULES){const contentHash=deterministicDigest(rule);const existing=await this.db.from("knowledge_rules").select("id").eq("rule_key",rule.key).eq("version",1).maybeSingle();if(existing.error)throw existing.error;let id=existing.data?.id;if(!id){const saved=await this.db.from("knowledge_rules").insert({rule_key:rule.key,version:1,domain:rule.domain,topic:rule.topic,principle:rule.principle,knowledge_type:rule.type,evidence_level:rule.level,applicable_agents:rule.agents,required_context:rule.required??[],exceptions:rule.exceptions??[],tags:rule.tags,conflicts_with:rule.conflicts??[],effective_at:ACCESSED_AT,available_at:ACCESSED_AT,status:"ACTIVE",content_hash:contentHash}).select("id").single();if(saved.error)throw saved.error;id=saved.data.id;inserted++}
   for(const sourceKey of rule.sources){const link=await this.db.from("knowledge_rule_sources").upsert({rule_id:id,source_id:sourceIds.get(sourceKey)!},{onConflict:"rule_id,source_id",ignoreDuplicates:true});if(link.error)throw link.error}
  }
  return{sources:sourceIds.size,rules:RULES.length,inserted};
 }
 async retrieve(query:KnowledgeQuery){
  const retrievedAt=new Date().toISOString();
  const rows=await this.db.from("knowledge_rules").select("*,knowledge_rule_sources(knowledge_sources(source_key))").lte("available_at",query.informationCutoffAt).order("rule_key");if(rows.error)throw rows.error;
  const rules=(rows.data??[]).map(mapRule);const result=retrieveKnowledge(rules,query);
  const trace=await this.db.from("knowledge_retrieval_traces").upsert({request_hash:result.requestHash,retrieval_version:result.retrievalVersion,agent:query.agent,information_cutoff_at:query.informationCutoffAt,context:query.context??{},selected_rule_refs:result.selected.map(x=>`${x.ruleKey}@${x.version}`),excluded_rules:result.excluded,conflicts:result.conflicts,available_at:retrievedAt},{onConflict:"request_hash",ignoreDuplicates:true}).select("id").maybeSingle();if(trace.error)throw trace.error;
  await this.transport.publish(createEventEnvelope({eventType:"knowledge.context_retrieved",entityType:"knowledge_retrieval",entityId:result.requestHash,assetId:null,occurredAt:retrievedAt,observedAt:retrievedAt,availableAt:retrievedAt,provider:"expert-knowledge",sourceReference:`knowledge:${result.requestHash}`,dataQuality:100,confidence:null,payload:{retrievalVersion:EXPERT_KNOWLEDGE_VERSION,informationCutoffAt:query.informationCutoffAt,selectedRuleRefs:result.selected.map(x=>`${x.ruleKey}@${x.version}`),conflicts:result.conflicts},correlationId:null,causationId:null}));
  return{...result,traceId:trace.data?.id??null};
 }
}
function mapRule(row:any):KnowledgeRule{return{id:row.id,ruleKey:row.rule_key,version:row.version,domain:row.domain,topic:row.topic,principle:row.principle,knowledgeType:row.knowledge_type,evidenceLevel:row.evidence_level,applicableAgents:row.applicable_agents??[],requiredContext:row.required_context??[],exceptions:row.exceptions??[],tags:row.tags??[],sourceRefs:(row.knowledge_rule_sources??[]).map((x:any)=>x.knowledge_sources?.source_key).filter(Boolean),conflictsWith:row.conflicts_with??[],effectiveAt:row.effective_at,availableAt:row.available_at,deprecatedAt:row.deprecated_at,status:row.status,systemLearnedEvidence:row.system_learned_evidence};}
