import { deterministicDigest } from "@/domain/events";
import type { ExecutionOrderRequest,ExecutionProvider,ProviderOrder } from "./provider";
export class ShadowExecutionProvider implements ExecutionProvider{
  readonly name="shadow-execution";readonly mode="SHADOW" as const;private orders=new Map<string,ProviderOrder>();
  async health(){return{status:"HEALTHY" as const,credentialsValid:true,tradePermission:true,withdrawPermission:false}}
  async getAccountState(){return{balances:[],positions:[],totalEquityUsd:null,availableQuoteUsd:null,status:"UNKNOWN" as const,unknownReasons:["SHADOW_PROVIDER_HAS_NO_EXTERNAL_ACCOUNT"],observedAt:new Date().toISOString(),sourceReference:null}}
  async placeOrder(order:ExecutionOrderRequest){const existing=this.orders.get(order.clientOrderId);if(existing)return existing;const result:ProviderOrder={providerOrderId:`shadow_${deterministicDigest(order.clientOrderId).slice(0,24)}`,clientOrderId:order.clientOrderId,state:"ACKNOWLEDGED",filledQuantity:0,averagePrice:null,observedAt:new Date().toISOString(),rawReference:null};this.orders.set(order.clientOrderId,result);return result}
  async getOrder(_instrumentId:string,clientOrderId:string){return this.orders.get(clientOrderId)??null}
  async cancelOrder(_instrumentId:string,clientOrderId:string){const current=this.orders.get(clientOrderId);if(!current)throw new Error("Shadow order not found");const cancelled={...current,state:"CANCELLED" as const,observedAt:new Date().toISOString()};this.orders.set(clientOrderId,cancelled);return cancelled}
}
