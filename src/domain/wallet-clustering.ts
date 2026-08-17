import { createHash } from "node:crypto";

export const WALLET_INDEPENDENCE_POLICY = { version:"wallet-independence-v1", minimumCoveragePercent:80, minimumPairDataQuality:80,
  clusterThreshold:80, synchronizedWindowSeconds:15, repeatedSynchronizationMinimum:3, sharedCounterpartyMinimum:3 } as const;
export type SourceClassification="wallet"|"exchange"|"bridge"|"program"|"unknown";
export type RelationshipEvidenceType="common_funder"|"funding_window"|"shared_counterparty"|"synchronized_behavior"|"common_creation_window";
export interface WalletRelationshipFeature { walletId:string; dataQuality:number; historyComplete:boolean; firstSeenAt:string|null; firstFundingAt:string|null;
  funderAddress:string|null; fundingSourceClassification:SourceClassification; counterparties:string[]; tradeTimesByAsset:Record<string,string[]>; }
export interface PairEvidence { walletAId:string;walletBId:string;evidenceType:RelationshipEvidenceType;classification:"same_owner_support"|"coordination_support"|"shared_service"|"independence_support"|"unknown";
  sourceClassification:SourceClassification;confidence:number;supportsCluster:boolean;details:Record<string,unknown>; }
export interface PairAssessment { walletAId:string;walletBId:string;status:"related"|"independent"|"unknown";confidence:number;evidence:PairEvidence[]; }
export interface WalletMembership { walletId:string;clusterId:string|null;relationshipStatus:"independent"|"clustered"|"unknown";independenceScore:number|null;clusterConfidence:number|null;
  fundingSourceClassification:SourceClassification;botRisk:number|null;mevRisk:number|null;exchangeRisk:number|null;evidenceIndexes:number[]; }
export interface ClusterEvaluation { modelVersion:string;scopeHash:string;rawWalletCount:number;relationshipPairCount:number;coveredPairCount:number;relationshipCoverage:number;
  confirmedIndependentCount:number;clusterAdjustedCount:number|null;status:"available"|"unknown";dataQuality:number;pairAssessments:PairAssessment[];memberships:WalletMembership[]; }

export function evaluateWalletIndependence(features:WalletRelationshipFeature[]):ClusterEvaluation{
  const wallets=[...new Map(features.map(item=>[item.walletId,item])).values()].sort((a,b)=>a.walletId.localeCompare(b.walletId));const pairs:PairAssessment[]=[];
  for(let a=0;a<wallets.length;a+=1)for(let b=a+1;b<wallets.length;b+=1)pairs.push(assessPair(wallets[a],wallets[b]));
  const covered=pairs.filter(pair=>pair.status!=="unknown"),coverage=pairs.length?round(covered.length/pairs.length*100):wallets.length<=1?100:0;
  const related=pairs.filter(pair=>pair.status==="related");const components=connectedComponents(wallets.map(x=>x.walletId),related);const relatedIds=new Set(related.flatMap(pair=>[pair.walletAId,pair.walletBId]));
  const evidence=pairEvidenceList(pairs);const memberships=wallets.map(wallet=>membership(wallet,components,related,pairs,evidence,relatedIds));
  const status=coverage>=WALLET_INDEPENDENCE_POLICY.minimumCoveragePercent?"available":"unknown";
  const confirmedIndependentCount=status==="available"?components.length:memberships.filter(item=>item.relationshipStatus==="independent").length;
  const adjusted=status==="available"?round(components.reduce((sum,component)=>{if(component.length===1)return sum+1;const confidence=Math.max(...related.filter(pair=>component.includes(pair.walletAId)&&component.includes(pair.walletBId)).map(pair=>pair.confidence));return sum+1+(component.length-1)*(1-confidence/100);},0)):null;
  const quality=wallets.length?Math.round(wallets.reduce((sum,item)=>sum+item.dataQuality,0)/wallets.length):0;
  return{modelVersion:WALLET_INDEPENDENCE_POLICY.version,scopeHash:hash(wallets.map(item=>item.walletId).join("|")),rawWalletCount:wallets.length,relationshipPairCount:pairs.length,
    coveredPairCount:covered.length,relationshipCoverage:coverage,confirmedIndependentCount,clusterAdjustedCount:adjusted,status,dataQuality:quality,pairAssessments:pairs,memberships};
}

export function assessPair(a:WalletRelationshipFeature,b:WalletRelationshipFeature):PairAssessment{
  const evidence:PairEvidence[]=[];const add=(value:Omit<PairEvidence,"walletAId"|"walletBId">)=>evidence.push({walletAId:a.walletId,walletBId:b.walletId,...value});
  if(a.funderAddress&&a.funderAddress===b.funderAddress){const service=["exchange","bridge","program"].includes(a.fundingSourceClassification)||["exchange","bridge","program"].includes(b.fundingSourceClassification);
    add({evidenceType:"common_funder",classification:service?"shared_service":"same_owner_support",sourceClassification:service?a.fundingSourceClassification:a.fundingSourceClassification==="wallet"&&b.fundingSourceClassification==="wallet"?"wallet":"unknown",confidence:service?95:45,supportsCluster:false,details:{funderAddress:a.funderAddress}});
    if(a.firstFundingAt&&b.firstFundingAt){const delta=Math.abs(Date.parse(a.firstFundingAt)-Date.parse(b.firstFundingAt));if(delta<=300_000)add({evidenceType:"funding_window",classification:service?"shared_service":"same_owner_support",sourceClassification:service?a.fundingSourceClassification:"unknown",confidence:service?90:20,supportsCluster:!service,details:{deltaMs:delta}});}}
  const shared=[...new Set(a.counterparties)].filter(item=>new Set(b.counterparties).has(item));if(shared.length>=WALLET_INDEPENDENCE_POLICY.sharedCounterpartyMinimum)add({evidenceType:"shared_counterparty",classification:"coordination_support",sourceClassification:"unknown",confidence:Math.min(35,15+shared.length*4),supportsCluster:true,details:{count:shared.length,counterparties:shared.sort()}});
  const sync=synchronizedOccurrences(a.tradeTimesByAsset,b.tradeTimesByAsset);if(sync>=WALLET_INDEPENDENCE_POLICY.repeatedSynchronizationMinimum)add({evidenceType:"synchronized_behavior",classification:"coordination_support",sourceClassification:"unknown",confidence:Math.min(35,10+sync*5),supportsCluster:true,details:{occurrences:sync,windowSeconds:WALLET_INDEPENDENCE_POLICY.synchronizedWindowSeconds}});
  if(a.firstSeenAt&&b.firstSeenAt){const delta=Math.abs(Date.parse(a.firstSeenAt)-Date.parse(b.firstSeenAt));if(delta<=300_000)add({evidenceType:"common_creation_window",classification:"coordination_support",sourceClassification:"unknown",confidence:10,supportsCluster:true,details:{deltaMs:delta}});}
  const relationConfidence=Math.min(99,evidence.filter(item=>item.supportsCluster).reduce((sum,item)=>sum+item.confidence,0));if(relationConfidence>=WALLET_INDEPENDENCE_POLICY.clusterThreshold)return{walletAId:a.walletId,walletBId:b.walletId,status:"related",confidence:relationConfidence,evidence};
  if(relationConfidence>0)return{walletAId:a.walletId,walletBId:b.walletId,status:"unknown",confidence:relationConfidence,evidence};
  const covered=a.historyComplete&&b.historyComplete&&a.dataQuality>=WALLET_INDEPENDENCE_POLICY.minimumPairDataQuality&&b.dataQuality>=WALLET_INDEPENDENCE_POLICY.minimumPairDataQuality;
  if(!covered)return{walletAId:a.walletId,walletBId:b.walletId,status:"unknown",confidence:0,evidence};
  add({evidenceType:"shared_counterparty",classification:"independence_support",sourceClassification:"unknown",confidence:Math.min(a.dataQuality,b.dataQuality),supportsCluster:false,details:{reason:"sufficient_history_without_cluster_threshold"}});
  return{walletAId:a.walletId,walletBId:b.walletId,status:"independent",confidence:Math.min(a.dataQuality,b.dataQuality),evidence};
}

function membership(wallet:WalletRelationshipFeature,components:string[][],related:PairAssessment[],pairs:PairAssessment[],allEvidence:PairEvidence[],relatedIds:Set<string>):WalletMembership{const component=components.find(item=>item.includes(wallet.walletId))!;const relevant=pairs.filter(pair=>pair.walletAId===wallet.walletId||pair.walletBId===wallet.walletId);const unknown=relevant.some(pair=>pair.status==="unknown");const clustered=relatedIds.has(wallet.walletId);const confidence=clustered?Math.max(...related.filter(pair=>pair.walletAId===wallet.walletId||pair.walletBId===wallet.walletId).map(pair=>pair.confidence)):null;
  const sync=relevant.flatMap(pair=>pair.evidence).filter(item=>item.evidenceType==="synchronized_behavior");const botRisk=sync.length?Math.min(100,Math.max(...sync.map(item=>item.confidence))*2):null;
  return{walletId:wallet.walletId,clusterId:clustered?`cluster_${hash(component.join("|" )).slice(0,20)}`:null,relationshipStatus:clustered?"clustered":unknown?"unknown":"independent",independenceScore:unknown?null:clustered?Math.max(0,100-(confidence??0)):Math.min(100,wallet.dataQuality),clusterConfidence:confidence,
    fundingSourceClassification:wallet.fundingSourceClassification,botRisk,mevRisk:null,exchangeRisk:wallet.fundingSourceClassification==="exchange"?90:wallet.fundingSourceClassification==="unknown"?null:0,evidenceIndexes:allEvidence.map((item,index)=>({item,index})).filter(({item})=>item.walletAId===wallet.walletId||item.walletBId===wallet.walletId).map(({index})=>index)};}
function synchronizedOccurrences(a:Record<string,string[]>,b:Record<string,string[]>){let count=0;for(const asset of Object.keys(a))for(const left of a[asset])if((b[asset]??[]).some(right=>Math.abs(Date.parse(left)-Date.parse(right))<=WALLET_INDEPENDENCE_POLICY.synchronizedWindowSeconds*1000))count+=1;return count;}
function connectedComponents(ids:string[],related:PairAssessment[]){const graph=new Map(ids.map(id=>[id,new Set<string>()]));for(const pair of related){graph.get(pair.walletAId)!.add(pair.walletBId);graph.get(pair.walletBId)!.add(pair.walletAId);}const seen=new Set<string>(),result:string[][]=[];for(const id of ids)if(!seen.has(id)){const stack=[id],group:string[]=[];while(stack.length){const next=stack.pop()!;if(seen.has(next))continue;seen.add(next);group.push(next);stack.push(...graph.get(next)!);}result.push(group.sort());}return result;}
function pairEvidenceList(pairs:PairAssessment[]){return pairs.flatMap(pair=>pair.evidence);}
function hash(value:string){return createHash("sha256").update(value).digest("hex");}function round(value:number){return Math.round(value*100)/100;}
