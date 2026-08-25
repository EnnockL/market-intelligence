import { deterministicDigest } from "./events";

export const EXPERT_KNOWLEDGE_VERSION = "expert-knowledge-v1";
export const SYSTEM_LEARNED_POLICY_VERSION = "system-learned-policy-v1";
export const SYSTEM_LEARNED_MIN_SAMPLE = 100;
export const SYSTEM_LEARNED_MIN_DATA_QUALITY = 80;

export type KnowledgeDomain = "MARKET_STRUCTURE"|"TECHNICAL"|"FUNDAMENTAL"|"RISK_MANAGEMENT"|"PSYCHOLOGY"|"MARKET_REGIME"|"MACRO"|"NEWS_CATALYST"|"MICROSTRUCTURE"|"PORTFOLIO"|"QUANTITATIVE"|"CRYPTO"|"RESEARCH_PROCESS"|"SYSTEM_GOVERNANCE";
export type KnowledgeType = "FOUNDATION"|"PROFESSIONAL"|"SYSTEM_LEARNED";
export type EvidenceLevel = "ACADEMIC"|"REGULATORY"|"ACCOUNTING_STANDARD"|"EMPIRICAL_SYSTEM"|"EXPERT_HEURISTIC";
export type RuleStatus = "ACTIVE"|"DEPRECATED";

export interface SystemLearnedEvidence { replayRunId:string; outcomeRecordIds:string[]; sampleSize:number; dataQuality:number; outOfSampleValidated:boolean; }
export interface KnowledgeRule {
  id:string; ruleKey:string; version:number; domain:KnowledgeDomain; topic:string; principle:string;
  knowledgeType:KnowledgeType; evidenceLevel:EvidenceLevel; applicableAgents:string[];
  requiredContext:string[]; exceptions:string[]; tags:string[]; sourceRefs:string[];
  conflictsWith:string[]; effectiveAt:string; availableAt:string; deprecatedAt:string|null;
  status:RuleStatus; systemLearnedEvidence:SystemLearnedEvidence|null;
}
export interface KnowledgeQuery { agent:string; informationCutoffAt:string; domains?:KnowledgeDomain[]; topics?:string[]; tags?:string[]; context?:Record<string,unknown>; }
export interface KnowledgeRetrieval {
  retrievalVersion:string; requestHash:string; informationCutoffAt:string; selected:KnowledgeRule[];
  excluded:Array<{ruleKey:string;reason:string}>; conflicts:Array<{left:string;right:string}>;
}

export function validateSystemLearnedRule(rule:Pick<KnowledgeRule,"knowledgeType"|"evidenceLevel"|"systemLearnedEvidence">){
  if(rule.knowledgeType!=="SYSTEM_LEARNED")return;
  const evidence=rule.systemLearnedEvidence;
  if(rule.evidenceLevel!=="EMPIRICAL_SYSTEM")throw new Error("SYSTEM_LEARNED requires EMPIRICAL_SYSTEM evidence");
  if(!evidence?.replayRunId||!evidence.outcomeRecordIds.length)throw new Error("SYSTEM_LEARNED requires replay and outcome evidence");
  if(evidence.sampleSize<SYSTEM_LEARNED_MIN_SAMPLE)throw new Error("SYSTEM_LEARNED sample is too small");
  if(evidence.dataQuality<SYSTEM_LEARNED_MIN_DATA_QUALITY)throw new Error("SYSTEM_LEARNED data quality is insufficient");
  if(!evidence.outOfSampleValidated)throw new Error("SYSTEM_LEARNED requires out-of-sample validation");
}

export function retrieveKnowledge(rules:KnowledgeRule[],query:KnowledgeQuery):KnowledgeRetrieval{
  const selected:KnowledgeRule[]=[],excluded:KnowledgeRetrieval["excluded"]=[];
  for(const rule of rules){
    validateSystemLearnedRule(rule);
    let reason:string|null=null;
    if(rule.availableAt>query.informationCutoffAt||rule.effectiveAt>query.informationCutoffAt)reason="NOT_YET_AVAILABLE";
    else if(rule.deprecatedAt&&rule.deprecatedAt<=query.informationCutoffAt)reason="DEPRECATED_AT_CUTOFF";
    else if(!rule.applicableAgents.includes("*")&&!rule.applicableAgents.includes(query.agent))reason="AGENT_NOT_APPLICABLE";
    else if(query.domains?.length&&!query.domains.includes(rule.domain))reason="DOMAIN_NOT_REQUESTED";
    else if(query.topics?.length&&!query.topics.includes(rule.topic))reason="TOPIC_NOT_REQUESTED";
    else if(query.tags?.length&&!query.tags.some(tag=>rule.tags.includes(tag)))reason="TAG_NOT_MATCHED";
    else if(rule.requiredContext.some(key=>query.context?.[key]===undefined||query.context?.[key]===null))reason="REQUIRED_CONTEXT_MISSING";
    if(reason)excluded.push({ruleKey:rule.ruleKey,reason});else selected.push(rule);
  }
  selected.sort((a,b)=>a.domain.localeCompare(b.domain)||a.topic.localeCompare(b.topic)||a.ruleKey.localeCompare(b.ruleKey)||a.version-b.version);
  const keys=new Set(selected.map(rule=>rule.ruleKey));
  const conflicts=selected.flatMap(left=>left.conflictsWith.filter(right=>keys.has(right)&&left.ruleKey<right).map(right=>({left:left.ruleKey,right})));
  const requestHash=deterministicDigest({version:EXPERT_KNOWLEDGE_VERSION,query,selected:selected.map(x=>`${x.ruleKey}@${x.version}`)});
  return{retrievalVersion:EXPERT_KNOWLEDGE_VERSION,requestHash,informationCutoffAt:query.informationCutoffAt,selected,excluded,conflicts};
}
