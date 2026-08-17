import { deterministicDigest } from "./events";
import { horizonMs, type ForecastHorizon } from "./forecast";

export const BASELINE_FORECAST_VERSION="historical-cohort-baseline-v1";
export const BASELINE_FEATURE_VERSION="market-features-v1";
export const BASELINE_COHORT_POLICY={version:"exact-buckets-v1",minimumSampleSize:30,minimumDataQuality:70,quantileLower:.1,quantileUpper:.9}as const;
export interface BaselineFeature{priceMomentum5m:number|null;volumeMultiple5m:number|null;liquidityUsd:number|null;marketCapUsd:number|null;dataQuality:number;}
export interface HistoricalExample{sourceId:string;assetId:string;anchorAt:string;outcomeAt:string;availableAt:string;features:BaselineFeature;returnPct:number;}
export interface BaselineResult{status:"AVAILABLE"|"INSUFFICIENT_DATA";reason:string|null;sampleSize:number;expectedReturn:number|null;lowerBound:number|null;upperBound:number|null;probabilityPositive:number|null;probability2x:number|null;probability5x:number|null;probability10x:number|null;dataQuality:number|null;members:Array<{sourceId:string;returnPct:number}>;modelHash:string;}

export function featureBucket(feature:BaselineFeature){return{momentum:bucket(feature.priceMomentum5m,[-20,-5,5,20]),volume:bucket(feature.volumeMultiple5m,[.5,1,2,5]),liquidity:logBucket(feature.liquidityUsd),marketCap:logBucket(feature.marketCapUsd)};}
export function buildHistoricalBaseline(target:BaselineFeature,examples:HistoricalExample[],horizon:ForecastHorizon,informationCutoffAt="9999-12-31T23:59:59Z"):BaselineResult{
 const targetBucket=featureBucket(target);
 const eligible=examples.filter(example=>example.availableAt<=informationCutoffAt&&example.features.dataQuality>=BASELINE_COHORT_POLICY.minimumDataQuality&&sameBucket(targetBucket,featureBucket(example.features))).sort((a,b)=>a.anchorAt.localeCompare(b.anchorAt)||a.sourceId.localeCompare(b.sourceId));
 const members=eligible.map(x=>({sourceId:x.sourceId,returnPct:x.returnPct}));
 const modelHash=deterministicDigest({version:BASELINE_FORECAST_VERSION,featureVersion:BASELINE_FEATURE_VERSION,policy:BASELINE_COHORT_POLICY.version,horizon,targetBucket,members});
 if(target.dataQuality<BASELINE_COHORT_POLICY.minimumDataQuality)return insufficient("TARGET_DATA_QUALITY_INSUFFICIENT",members,modelHash);
 if(requiredMissing(target))return insufficient("TARGET_FEATURES_INCOMPLETE",members,modelHash);
 if(members.length<BASELINE_COHORT_POLICY.minimumSampleSize)return insufficient("COHORT_SAMPLE_INSUFFICIENT",members,modelHash);
 const returns=members.map(x=>x.returnPct).sort((a,b)=>a-b),mean=returns.reduce((a,b)=>a+b,0)/returns.length,quality=Math.round(eligible.reduce((a,b)=>a+b.features.dataQuality,0)/eligible.length);
 return{status:"AVAILABLE",reason:null,sampleSize:returns.length,expectedReturn:mean,lowerBound:quantile(returns,.1),upperBound:quantile(returns,.9),probabilityPositive:probability(returns,x=>x>0),probability2x:probability(returns,x=>x>=100),probability5x:probability(returns,x=>x>=400),probability10x:probability(returns,x=>x>=900),dataQuality:quality,members,modelHash};
}
export function calculateForwardReturn(entry:number,exit:number){if(!(entry>0)||!(exit>0))throw new Error("Prices must be positive");return(exit/entry-1)*100;}
export function targetTime(anchor:string,horizon:ForecastHorizon){return new Date(Date.parse(anchor)+horizonMs(horizon)).toISOString();}
function insufficient(reason:string,members:BaselineResult["members"],modelHash:string):BaselineResult{return{status:"INSUFFICIENT_DATA",reason,sampleSize:members.length,expectedReturn:null,lowerBound:null,upperBound:null,probabilityPositive:null,probability2x:null,probability5x:null,probability10x:null,dataQuality:null,members,modelHash};}
function requiredMissing(x:BaselineFeature){return x.priceMomentum5m===null||x.volumeMultiple5m===null||x.liquidityUsd===null;}
function bucket(value:number|null,cuts:number[]){if(value===null)return"UNKNOWN";return String(cuts.findIndex(c=>value<c)===-1?cuts.length:cuts.findIndex(c=>value<c));}
function logBucket(value:number|null){if(value===null||value<=0)return"UNKNOWN";return String(Math.floor(Math.log10(value)));}
function sameBucket(a:ReturnType<typeof featureBucket>,b:ReturnType<typeof featureBucket>){return a.momentum===b.momentum&&a.volume===b.volume&&a.liquidity===b.liquidity&&a.marketCap===b.marketCap;}
function quantile(sorted:number[],q:number){const i=(sorted.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);}
function probability(values:number[],predicate:(x:number)=>boolean){return values.filter(predicate).length/values.length*100;}
