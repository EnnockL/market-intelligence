import type { SupabaseClient } from "@supabase/supabase-js";
import { executionClientOrderId,assertExecutionTransition,createExecutionIntent,evaluateExecutionSafety,type ExecutionIntentInput,type ExecutionLimits,type SafetyContext,type ExecutionState } from "@/domain/execution";
import { deterministicDigest } from "@/domain/events";
import type { ExecutionProvider,ProviderOrder } from "./provider";
import { checkQueuedExecution, type QueuedExecutionOrder } from "./submission-guard";
import { normalizeOrderObservation } from "./order-observation";

export class ExecutionService{
  constructor(private db:SupabaseClient,private provider:ExecutionProvider){}
  async createAndEvaluate(input:ExecutionIntentInput,context:SafetyContext,limits:ExecutionLimits){
    const intent=createExecutionIntent(input),insertedIntent=await this.db.from("execution_intents").upsert({intent_key:intent.intentKey,contract_version:intent.contractVersion,source_type:intent.sourceType,source_id:intent.sourceId,asset_id:intent.assetId,instrument_id:intent.instrumentId,side:intent.side,order_type:intent.orderType,quote_amount_sek:intent.quoteAmountSek,quantity:intent.quantity,limit_price:intent.limitPrice,stop_price:intent.stopPrice,target_price:intent.targetPrice,max_slippage_bps:intent.maxSlippageBps,information_cutoff_at:intent.informationCutoffAt,available_at:intent.availableAt,expires_at:intent.expiresAt,evidence_refs:intent.evidenceRefs,consensus_version:intent.consensusVersion,forecast_version:intent.forecastVersion,risk_version:intent.riskVersion,strategy_attribution_id:intent.strategyAttributionId??null,payload_hash:intent.payloadHash},{onConflict:"intent_key",ignoreDuplicates:true}).select("id").maybeSingle();
    if(insertedIntent.error)throw insertedIntent.error;
    const insert=insertedIntent.data?insertedIntent:await this.db.from("execution_intents").select("id").eq("intent_key",intent.intentKey).single();
    if(insert.error)throw insert.error;if(!insert.data)throw new Error("Execution intent could not be read");const safety=evaluateExecutionSafety(intent,context,limits),evaluationKey=deterministicDigest({intentKey:intent.intentKey,resultHash:safety.resultHash});
    const insertedEvaluation=await this.db.from("execution_safety_evaluations").upsert({evaluation_key:evaluationKey,intent_id:insert.data.id,policy_version:safety.policyVersion,decision:safety.decision,requirements:safety.requirements,context,limits,result_hash:safety.resultHash,information_cutoff_at:intent.informationCutoffAt,available_at:new Date().toISOString()},{onConflict:"evaluation_key",ignoreDuplicates:true}).select("id").maybeSingle();if(insertedEvaluation.error)throw insertedEvaluation.error;
    const evaluation=insertedEvaluation.data?insertedEvaluation:await this.db.from("execution_safety_evaluations").select("id").eq("evaluation_key",evaluationKey).single();if(evaluation.error)throw evaluation.error;if(!evaluation.data)throw new Error("Execution safety evaluation could not be read");
    const order=await this.ensureOrder(insert.data.id,evaluation.data.id,intent.intentKey,safety.decision==="PASSED"?"SAFETY_PASSED":"BLOCKED");return{intentId:insert.data.id,evaluationId:evaluation.data.id,orderId:order.id,decision:safety.decision,requirements:safety.requirements};
  }
  private async ensureOrder(intentId:string,evaluationId:string,intentKey:string,state:ExecutionState){
    const source=await this.db.from("execution_intents").select("strategy_attribution_id").eq("id",intentId).single();if(source.error)throw source.error;
    const accountKey=this.provider.mode==="SHADOW"?"shadow-primary":`${this.provider.name}-primary`;
    const account=await this.db.from("execution_accounts").select("id").eq("account_key",accountKey).eq("provider",this.provider.name).eq("provider_environment",this.provider.mode).maybeSingle();if(account.error)throw account.error;
    const row=await this.db.from("execution_orders").upsert({account_id:account.data?.id??null,intent_id:intentId,safety_evaluation_id:evaluationId,strategy_attribution_id:source.data.strategy_attribution_id,provider:this.provider.name,provider_environment:this.provider.mode,client_order_id:executionClientOrderId(intentKey),current_state:state},{onConflict:"intent_id",ignoreDuplicates:true}).select("id,current_state,created_at").maybeSingle();if(row.error)throw row.error;
    if(!row.data){const existing=await this.db.from("execution_orders").select("id,current_state,created_at").eq("intent_id",intentId).single();if(existing.error)throw existing.error;return existing.data}
    const eventKey=deterministicDigest({orderId:row.data.id,from:"PROPOSED",to:state,reason:"INITIAL_SAFETY_EVALUATION"}),event=await this.db.from("execution_order_events").upsert({event_key:eventKey,order_id:row.data.id,previous_state:"PROPOSED",next_state:state,reason:"INITIAL_SAFETY_EVALUATION",payload:{},occurred_at:row.data.created_at,available_at:new Date().toISOString()},{onConflict:"event_key",ignoreDuplicates:true});if(event.error)throw event.error;return row.data;
  }
  async submitReady(limit=25) {
    const { data: orders, error } = await this.db.from("execution_orders")
      .select("id,account_id,intent_id,safety_evaluation_id,provider,provider_environment,current_state,client_order_id,provider_order_id,execution_intents!inner(*)")
      .eq("provider",this.provider.name).eq("provider_environment",this.provider.mode).eq("current_state", "SAFETY_PASSED").order("created_at").limit(limit);
    if (error) throw error;
    let submitted = 0, blocked = 0, unavailable = 0;
    for (const row of (orders ?? []) as unknown as QueuedExecutionOrder[]) {
      let check: Awaited<ReturnType<typeof checkQueuedExecution>>;
      try { check = await checkQueuedExecution(this.db, this.provider, row); }
      catch {
        // Read/provider failure cannot reuse the approval captured at enqueue.
        if(await this.denyQueuedOrder(row.id, "FINAL_GUARD_UNAVAILABLE"))blocked++;else unavailable++;
        continue;
      }
      if (check.decision !== "PASSED") {
        if(await this.denyQueuedOrder(row.id, check.reason))blocked++;else unavailable++;
        continue;
      }
      const intent = one(row.execution_intents)!;
      // Build the request BEFORE the final DB boundary. No awaited work may be
      // inserted between an authorized claim and the actual provider call.
      const request = { clientOrderId: row.client_order_id, instrumentId: intent.instrument_id, side: intent.side, orderType: intent.order_type, quantity: intent.quantity === null ? null : Number(intent.quantity), quoteAmountSek: Number(intent.quote_amount_sek), limitPrice: intent.limit_price === null ? null : Number(intent.limit_price) };
      let claim: { data: any; error: unknown };
      try {
        claim = await this.db.rpc("authorize_execution_submission", {
          p_order_id: row.id, p_provider: this.provider.name, p_mode: this.provider.mode,
          p_control_revision: check.controlRevision, p_account_id: check.accountId, p_account_revision: check.accountRevision,
          p_risk_snapshot_id: check.riskSnapshotId, p_account_observation_id: check.accountObservationId,
          p_safety_evaluation_id: check.safetyEvaluationId, p_check: check,
        });
      } catch { unavailable++; continue; }
      // An RPC error/ambiguous result may have committed a claim. Do not send or
      // blindly retry here; existing reconciliation owns uncertain states.
      if (claim.error || claim.data?.authorized !== true || claim.data.orderId !== row.id || claim.data.state !== "SUBMITTING") {
        if (!claim.error && claim.data?.authorized === false) blocked++; else unavailable++;
        continue;
      }
      let providerOrder: ProviderOrder;
      try { providerOrder = await this.provider.placeOrder(request); }
      catch {
        await this.transition(row.id, "SUBMITTING", "RECONCILIATION_REQUIRED", "PROVIDER_SUBMISSION_UNCERTAIN", null);
        continue;
      }
      const saved = await this.db.from("execution_orders").update({ provider_order_id: providerOrder.providerOrderId }).eq("id", row.id);
      if (saved.error) throw saved.error;
      await this.transition(row.id, "SUBMITTING", "SUBMITTED", "PROVIDER_ACCEPTED", providerOrder);
      await this.transition(row.id, "SUBMITTED", providerOrder.state, providerOrder.state === "ACKNOWLEDGED" ? "PROVIDER_ACKNOWLEDGED" : "PROVIDER_STATE", providerOrder);
      submitted++;
    }
    return { submitted, considered: orders?.length ?? 0, blocked, unavailable };
  }
  private async denyQueuedOrder(orderId:string,reason:string){
    // The state change and audit append are atomic. A losing concurrent worker
    // must not append a false BLOCKED event to an already claimed order.
    try{const result=await this.db.rpc("deny_execution_submission",{p_order_id:orderId,p_reason:reason});return!result.error&&result.data?.blocked===true}catch{return false}
  }
  async reconcile(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("RECONCILIATION_READ_BUDGET_INVALID");
    const startedAt = new Date().toISOString();
    const { data, error } = await this.db.from("execution_orders")
      .select("id,current_state,client_order_id,provider_order_id,reconciliation_revision,execution_intents!inner(instrument_id)")
      .eq("provider", this.provider.name).eq("provider_environment", this.provider.mode)
      .in("current_state", ["SUBMITTING", "SUBMITTED", "ACKNOWLEDGED", "PARTIALLY_FILLED", "RECONCILIATION_REQUIRED"])
      .order("last_provider_observed_at", { ascending: true, nullsFirst: true }).order("id").limit(limit + 1);
    if (error) throw error;
    const incomplete = (data?.length ?? 0) > limit, orders = (data ?? []).slice(0, limit);
    let mismatches = incomplete ? 1 : 0, recovered = 0;
    for (const row of orders) {
      const intent = one((row as any).execution_intents);
      const revision = Number(row.reconciliation_revision);
      if (!intent || row.reconciliation_revision === null || row.reconciliation_revision === undefined
        || !Number.isSafeInteger(revision) || revision < 0) { mismatches++; continue; }
      try {
        const observed = await this.provider.getOrder(intent.instrument_id, row.client_order_id, row.provider_order_id);
        const observation = observed === null ? null : normalizeOrderObservation(observed, row.client_order_id);
        const result = await this.db.rpc("persist_execution_order_observation", {
          p_order_id: row.id, p_provider: this.provider.name, p_environment: this.provider.mode,
          p_instrument_id: intent.instrument_id, p_client_order_id: row.client_order_id,
          p_expected_revision: revision, p_observation: observation,
        });
        // A failed response can represent a committed observation. Never retry
        // blindly or continue into capture/submission with uncertain knowledge.
        if (result.error || result.data?.orderId !== row.id
          || !["APPLIED", "DUPLICATE", "UNCHANGED"].includes(result.data?.status) || observation === null) {
          mismatches++;
        } else if (result.data.status === "APPLIED") recovered++;
      } catch { mismatches++; }
    }
    const finishedAt = new Date().toISOString();
    const runKey = deterministicDigest({ provider: this.provider.name, mode: this.provider.mode, startedAt, finishedAt, checked: orders.length, mismatches, recovered });
    const saved = await this.db.from("execution_reconciliation_runs").insert({ run_key: runKey, provider: this.provider.name,
      provider_environment: this.provider.mode, started_at: startedAt, finished_at: finishedAt, orders_checked: orders.length,
      mismatches, recovered, status: mismatches ? "DEGRADED" : "SUCCEEDED", details: { version: "execution-order-observation-v1", readBudgetExceeded: incomplete } });
    if (saved.error) throw saved.error;
    if (mismatches) throw new Error("EXECUTION_RECONCILIATION_INCOMPLETE");
    return { checked: orders.length, mismatches, recovered };
  }
  private async transition(orderId:string,from:ExecutionState,to:ExecutionState,reason:string,providerOrder:ProviderOrder|null){assertExecutionTransition(from,to);const now=new Date().toISOString(),eventKey=deterministicDigest({orderId,from,to,reason,providerOrderId:providerOrder?.providerOrderId??null,observedAt:providerOrder?.observedAt??now});const event=await this.db.from("execution_order_events").upsert({event_key:eventKey,order_id:orderId,previous_state:from,next_state:to,reason,provider_reference:providerOrder?.rawReference??null,payload:providerOrder??{},occurred_at:providerOrder?.observedAt??now,available_at:now},{onConflict:"event_key",ignoreDuplicates:true});if(event.error)throw event.error;const update=await this.db.from("execution_orders").update({current_state:to,filled_quantity:providerOrder?.filledQuantity??0,average_price:providerOrder?.averagePrice??null,last_provider_observed_at:providerOrder?.observedAt??null,updated_at:now}).eq("id",orderId).eq("current_state",from).select("id");if(update.error)throw update.error;if(!update.data?.length)throw new Error("Concurrent execution transition rejected")}
}
function one<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?value[0]??null:value??null}
