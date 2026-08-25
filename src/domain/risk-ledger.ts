import { deterministicDigest } from "./events";

export const RISK_LEDGER_VERSION = "risk-ledger-v1";
export type AccountValueStatus = "KNOWN" | "UNKNOWN";
export interface LedgerFill { fillId:string; side:"BUY"|"SELL"; quantity:number; priceSek:number|null; feeSek:number|null; occurredAt:string; availableAt:string }
export interface AccountRiskInput { accountId:string; initialCashSek:number|null; fills:LedgerFill[]; reservedExposureSek:number|null; cutoffAt:string }

export function rebuildRiskLedger(input:AccountRiskInput){
  const ordered=[...input.fills].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.fillId.localeCompare(b.fillId));
  let cash=input.initialCashSek,quantity=0,averageCostSek=0,realizedPnlSek=0,feesSek=0;
  const unknown:string[]=[];
  if(cash===null)unknown.push("INITIAL_CASH_UNKNOWN");
  for(const fill of ordered){
    if(Date.parse(fill.availableAt)>Date.parse(input.cutoffAt))throw new Error("Future fill rejected");
    if(fill.priceSek===null||fill.feeSek===null){unknown.push(`FILL_VALUE_UNKNOWN:${fill.fillId}`);continue}
    const gross=fill.quantity*fill.priceSek,fee=fill.feeSek;feesSek+=fee;
    if(fill.side==="BUY"){
      const next=quantity+fill.quantity;averageCostSek=next>0?(quantity*averageCostSek+gross+fee)/next:0;quantity=next;if(cash!==null)cash-=gross+fee;
    }else{
      if(fill.quantity>quantity){unknown.push(`SELL_EXCEEDS_POSITION:${fill.fillId}`);continue}
      realizedPnlSek+=(fill.priceSek-averageCostSek)*fill.quantity-fee;quantity-=fill.quantity;if(quantity===0)averageCostSek=0;if(cash!==null)cash+=gross-fee;
    }
  }
  const status:AccountValueStatus=unknown.length||input.reservedExposureSek===null?"UNKNOWN":"KNOWN";
  if(input.reservedExposureSek===null)unknown.push("RESERVED_EXPOSURE_UNKNOWN");
  const snapshot={version:RISK_LEDGER_VERSION,accountId:input.accountId,status,cashSek:cash,openQuantity:quantity,averageCostSek:status==="KNOWN"?averageCostSek:null,realizedPnlSek:status==="KNOWN"?realizedPnlSek:null,feesSek:status==="KNOWN"?feesSek:null,reservedExposureSek:input.reservedExposureSek,openPositions:quantity>0?1:0,cutoffAt:input.cutoffAt,unknownReasons:[...new Set(unknown)].sort()};
  return{...snapshot,snapshotKey:`risk_${deterministicDigest(snapshot).slice(0,40)}`,resultHash:deterministicDigest(snapshot)};
}

export function riskContextFromSnapshot(snapshot:ReturnType<typeof rebuildRiskLedger>){
  if(snapshot.status!=="KNOWN"||snapshot.realizedPnlSek===null||snapshot.reservedExposureSek===null)return{status:"UNKNOWN" as const,openPositions:null,dailyLossSek:null,totalExposureSek:null,availableCashSek:null};
  return{status:"KNOWN" as const,openPositions:snapshot.openPositions,dailyLossSek:Math.max(0,-snapshot.realizedPnlSek),totalExposureSek:snapshot.reservedExposureSek,availableCashSek:snapshot.cashSek};
}
