import { deterministicDigest } from "./events";

export const EXECUTION_CONTRACT_VERSION = "execution-contract-v1";
export const EXECUTION_SAFETY_POLICY_VERSION = "execution-safety-policy-v1";
export type ExecutionMode = "SHADOW" | "DEMO";
export type ExecutionState = "PROPOSED"|"SAFETY_PASSED"|"BLOCKED"|"SUBMITTING"|"SUBMITTED"|"ACKNOWLEDGED"|"PARTIALLY_FILLED"|"FILLED"|"CANCELLED"|"REJECTED"|"EXPIRED"|"RECONCILIATION_REQUIRED"|"CLOSED"|"MANUAL_INTERVENTION";
export type RequirementStatus = "PASS"|"FAIL"|"UNKNOWN";
export interface ExecutionIntentInput { sourceType:string;sourceId:string;assetId:string;instrumentId:string;side:"BUY"|"SELL";orderType:"MARKET"|"LIMIT";quoteAmountSek:number;quantity:number|null;limitPrice:number|null;stopPrice:number|null;targetPrice:number|null;maxSlippageBps:number;informationCutoffAt:string;availableAt:string;expiresAt:string;evidenceRefs:string[];consensusVersion:string|null;forecastVersion:string|null;riskVersion:string|null; }
export interface SafetyRequirement { code:string;status:RequirementStatus;observedValue:unknown;requiredValue:unknown;blockerCode:string|null; }
export interface SafetyContext { mode:ExecutionMode;killSwitch:boolean;newOrdersEnabled:boolean;liveExecutionEnabled:boolean;providerStatus:"HEALTHY"|"DEGRADED"|"FAILED"|"UNKNOWN";credentialsValid:boolean|null;tradePermission:boolean|null;withdrawPermission:boolean|null;instrumentType:"SPOT"|"MARGIN"|"FUTURES"|"UNKNOWN";leverage:number|null;openPositions:number|null;dailyLossSek:number|null;totalExposureSek:number|null;availableCashSek:number|null;dataAgeMs:number|null;criticalSafety:"PASS"|"FAIL"|"UNKNOWN";liquidityStatus:"PASS"|"FAIL"|"UNKNOWN";riskStatus:"PASS"|"FAIL"|"UNKNOWN"; }
export interface ExecutionLimits { minOrderSek:number;maxOrderSek:number;maxOpenPositions:number;maxDailyLossSek:number;maxTotalExposureSek:number;maxDataAgeMs:number;maxSlippageBps:number; }

export function createExecutionIntent(input:ExecutionIntentInput){
  if(Date.parse(input.availableAt)>Date.parse(input.informationCutoffAt))throw new Error("Future evidence rejected");
  if(Date.parse(input.informationCutoffAt)>=Date.parse(input.expiresAt))throw new Error("Intent must expire after its information cutoff");
  const normalized={...input,evidenceRefs:[...new Set(input.evidenceRefs)].sort(),contractVersion:EXECUTION_CONTRACT_VERSION};
  return{...normalized,intentKey:`intent_${deterministicDigest(normalized).slice(0,40)}`,payloadHash:deterministicDigest(normalized)};
}

export function evaluateExecutionSafety(intent:ReturnType<typeof createExecutionIntent>,context:SafetyContext,limits:ExecutionLimits){
  const addedExposure=intent.side==="BUY"?intent.quoteAmountSek:0;
  const requirements:SafetyRequirement[]=[
    req("KILL_SWITCH",context.killSwitch?"FAIL":"PASS",context.killSwitch,false,"KILL_SWITCH_ACTIVE"),
    req("NEW_ORDERS_ENABLED",context.newOrdersEnabled?"PASS":"FAIL",context.newOrdersEnabled,true,"NEW_ORDERS_DISABLED"),
    req("LIVE_EXECUTION_DISABLED",context.liveExecutionEnabled?"FAIL":"PASS",context.liveExecutionEnabled,false,"LIVE_EXECUTION_NOT_ALLOWED_V1"),
    req("PROVIDER_HEALTH",context.providerStatus==="UNKNOWN"?"UNKNOWN":context.providerStatus==="HEALTHY"?"PASS":"FAIL",context.providerStatus,"HEALTHY","PROVIDER_UNAVAILABLE"),
    boolReq("CREDENTIALS_VALID",context.credentialsValid,true,"CREDENTIALS_UNKNOWN_OR_INVALID"),
    boolReq("TRADE_PERMISSION",context.tradePermission,true,"TRADE_PERMISSION_MISSING"),
    boolReq("NO_WITHDRAW_PERMISSION",context.withdrawPermission,false,"WITHDRAW_PERMISSION_PRESENT_OR_UNKNOWN"),
    req("SPOT_ONLY",context.instrumentType==="UNKNOWN"?"UNKNOWN":context.instrumentType==="SPOT"?"PASS":"FAIL",context.instrumentType,"SPOT","NON_SPOT_INSTRUMENT"),
    req("NO_LEVERAGE",context.leverage===null?"UNKNOWN":context.leverage<=1?"PASS":"FAIL",context.leverage,"<= 1","LEVERAGE_NOT_ALLOWED"),
    req("POSITION_LIMIT",context.openPositions===null?"UNKNOWN":context.openPositions<limits.maxOpenPositions?"PASS":"FAIL",context.openPositions,`< ${limits.maxOpenPositions}`,"MAX_OPEN_POSITIONS"),
    req("DAILY_LOSS_LIMIT",context.dailyLossSek===null?"UNKNOWN":context.dailyLossSek<limits.maxDailyLossSek?"PASS":"FAIL",context.dailyLossSek,`< ${limits.maxDailyLossSek}`,"DAILY_LOSS_LIMIT"),
    req("TOTAL_EXPOSURE_LIMIT",context.totalExposureSek===null?"UNKNOWN":context.totalExposureSek+addedExposure<=limits.maxTotalExposureSek?"PASS":"FAIL",context.totalExposureSek===null?null:context.totalExposureSek+addedExposure,`<= ${limits.maxTotalExposureSek}`,"TOTAL_EXPOSURE_LIMIT"),
    req("AVAILABLE_CASH",intent.side==="SELL"?"PASS":context.availableCashSek===null?"UNKNOWN":context.availableCashSek>=intent.quoteAmountSek?"PASS":"FAIL",context.availableCashSek,intent.side==="SELL"?"NOT_APPLICABLE":`>= ${intent.quoteAmountSek}`,"INSUFFICIENT_OR_UNKNOWN_CASH"),
    req("ORDER_SIZE",intent.quoteAmountSek>=limits.minOrderSek&&intent.quoteAmountSek<=limits.maxOrderSek?"PASS":"FAIL",intent.quoteAmountSek,`${limits.minOrderSek}-${limits.maxOrderSek}`,"ORDER_SIZE_OUT_OF_RANGE"),
    req("SLIPPAGE_LIMIT",intent.maxSlippageBps<=limits.maxSlippageBps?"PASS":"FAIL",intent.maxSlippageBps,`<= ${limits.maxSlippageBps}`,"SLIPPAGE_TOO_HIGH"),
    req("FRESH_DATA",context.dataAgeMs===null?"UNKNOWN":context.dataAgeMs<=limits.maxDataAgeMs?"PASS":"FAIL",context.dataAgeMs,`<= ${limits.maxDataAgeMs}`,"DATA_STALE_OR_UNKNOWN"),
    statusReq("CRITICAL_SAFETY",context.criticalSafety,"CRITICAL_SAFETY_UNKNOWN_OR_FAILED"),statusReq("LIQUIDITY",context.liquidityStatus,"LIQUIDITY_UNKNOWN_OR_FAILED"),statusReq("TOKEN_RISK",context.riskStatus,"TOKEN_RISK_UNKNOWN_OR_FAILED"),
    req("STOP_DEFINED",intent.stopPrice!==null?"PASS":"FAIL",intent.stopPrice,"number","STOP_REQUIRED"),req("TARGET_DEFINED",intent.targetPrice!==null?"PASS":"FAIL",intent.targetPrice,"number","TARGET_REQUIRED"),
  ];
  const decision=requirements.every(x=>x.status==="PASS")?"PASSED" as const:"BLOCKED" as const;
  return{policyVersion:EXECUTION_SAFETY_POLICY_VERSION,decision,requirements,resultHash:deterministicDigest({policyVersion:EXECUTION_SAFETY_POLICY_VERSION,intentKey:intent.intentKey,context,limits,requirements})};
}
function req(code:string,status:RequirementStatus,observedValue:unknown,requiredValue:unknown,blocker:string):SafetyRequirement{return{code,status,observedValue,requiredValue,blockerCode:status==="PASS"?null:blocker}}
function boolReq(code:string,value:boolean|null,required:boolean,blocker:string){return req(code,value===null?"UNKNOWN":value===required?"PASS":"FAIL",value,required,blocker)}
function statusReq(code:string,value:"PASS"|"FAIL"|"UNKNOWN",blocker:string){return req(code,value,value,"PASS",blocker)}

const transitions:Record<ExecutionState,ExecutionState[]>={PROPOSED:["SAFETY_PASSED","BLOCKED","EXPIRED"],SAFETY_PASSED:["SUBMITTING","BLOCKED","EXPIRED"],BLOCKED:[],SUBMITTING:["SUBMITTED","REJECTED","RECONCILIATION_REQUIRED"],SUBMITTED:["ACKNOWLEDGED","PARTIALLY_FILLED","FILLED","CANCELLED","REJECTED","RECONCILIATION_REQUIRED"],ACKNOWLEDGED:["PARTIALLY_FILLED","FILLED","CANCELLED","REJECTED","RECONCILIATION_REQUIRED"],PARTIALLY_FILLED:["FILLED","CANCELLED","RECONCILIATION_REQUIRED"],FILLED:["CLOSED","RECONCILIATION_REQUIRED"],CANCELLED:[],REJECTED:[],EXPIRED:[],RECONCILIATION_REQUIRED:["ACKNOWLEDGED","PARTIALLY_FILLED","FILLED","CANCELLED","REJECTED","MANUAL_INTERVENTION"],CLOSED:[],MANUAL_INTERVENTION:[]};
export function assertExecutionTransition(from:ExecutionState,to:ExecutionState){if(!transitions[from].includes(to))throw new Error(`Invalid execution transition: ${from} -> ${to}`);return true}
