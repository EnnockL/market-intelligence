import type { ExecutionMode } from "@/domain/execution";
import type { DemoAccountEvidence } from "./account-evidence";
export interface ExecutionOrderRequest{clientOrderId:string;instrumentId:string;side:"BUY"|"SELL";orderType:"MARKET"|"LIMIT";quantity:number|null;quoteAmountSek:number;limitPrice:number|null}
export interface ProviderOrder{providerOrderId:string;clientOrderId:string;state:"ACKNOWLEDGED"|"PARTIALLY_FILLED"|"FILLED"|"CANCELLED"|"REJECTED";filledQuantity:number;averagePrice:number|null;observedAt:string;rawReference:string|null}
export interface ProviderAccountState{balances:Array<{currency:string;total:number;available:number|null}>;positions:Array<{instrumentId:string;quantity:number;averagePrice:number|null;unrealizedPnl:number|null}>;totalEquityUsd:number|null;availableQuoteUsd:number|null;status:"KNOWN"|"PARTIAL"|"UNKNOWN";unknownReasons:string[];observedAt:string;sourceReference:string|null}
/** Exact decimal strings: never manufacture individual fills from order accFillSz. */
export interface ProviderExecutionFill {
  providerFillId:string; providerBillId:string; providerOrderId:string; clientOrderId:string|null;
  instrumentId:string; side:"BUY"|"SELL"; quantity:string; price:string;
  feeAmount:string; providerFeeAmount:string; feeCurrency:string;
  baseCurrency:string; quoteCurrency:string; quoteCurrencySource:"OKX_TRADE_QUOTE_CCY";
  occurredAt:string; providerRecordedAt:string;
}
export interface ProviderFillPageRequest {
  windowStart:string; windowEnd:string; afterBillId?:string|null; limit?:number;
  instrumentId?:string; providerOrderId?:string;
}
export type ProviderFillPage = {status:"UNSUPPORTED";reason:string} | {
  status:"SUPPORTED"; fills:ProviderExecutionFill[]; nextCursor:string|null; exhausted:boolean; observedAt:string;
  window:{requestedStart:string;requestedEnd:string;effectiveStart:string;effectiveEnd:string;retentionStart:string;
    retentionLimited:boolean;source:"OKX_FILLS_HISTORY_3_MONTHS";timeBasis:"PROVIDER_RECORDED_AT"};
};
export interface ExecutionProvider{readonly name:string;readonly mode:ExecutionMode;health():Promise<{status:"HEALTHY"|"DEGRADED"|"FAILED";credentialsValid:boolean;tradePermission:boolean;withdrawPermission:boolean|null;externalAccountId?:string}>;getAccountState():Promise<ProviderAccountState>;getAccountEvidence?(instrumentId:string,windowStart:string):Promise<DemoAccountEvidence>;getFillsPage?(request:ProviderFillPageRequest):Promise<ProviderFillPage>;placeOrder(order:ExecutionOrderRequest):Promise<ProviderOrder>;getOrder(instrumentId:string,clientOrderId:string,providerOrderId:string|null):Promise<ProviderOrder|null>;cancelOrder(instrumentId:string,clientOrderId:string,providerOrderId:string|null):Promise<ProviderOrder>}
