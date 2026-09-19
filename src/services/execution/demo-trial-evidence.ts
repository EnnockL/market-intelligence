import type { SupabaseClient } from "@supabase/supabase-js";
import { rebuildAccountLedgerV2, verifyAccountLedgerV2Snapshot } from "@/domain/account-ledger-v2";
import type { DemoTrialEvidence } from "@/domain/demo-trial";
import { readBoundedPages } from "@/repositories/bounded-read";
import { normalizeLedgerFill } from "./ledger-evidence";

export async function loadDemoTrialEvidence(db: SupabaseClient, trial: any, risk: any, actionId = ""): Promise<DemoTrialEvidence> {
  const full = risk?.ledger_payload;
  if (!verifyAccountLedgerV2Snapshot(full) || full.status !== "KNOWN" || full.accountId !== trial.account_id
    || !Array.isArray(risk.source_fill_ids) || trial.budget_sek !== 200 && Number(trial.budget_sek) !== 200) throw new Error("DEMO_TRIAL_ACCOUNT_UNKNOWN");
  const orders = await readBoundedPages<any>("demo-trial-orders", (from,to)=>db.from("demo_trial_orders").select("*")
    .eq("trial_id",trial.id).order("id").range(from,to));
  if (orders.some(o=>["SUBMITTING","RECONCILIATION_REQUIRED"].includes(o.current_state))) throw new Error("DEMO_TRIAL_ORDER_UNCERTAIN");
  const fills = await readBoundedPages<any>("demo-trial-fills",(from,to)=>db.from("demo_trial_fills").select("*")
    .eq("trial_id",trial.id).lte("occurred_at",full.economicCutoffAt).lte("available_at",full.cutoffAt).order("occurred_at").order("id").range(from,to));
  if (fills.some(f=>f.provenance_status!=="VERIFIED_PROVIDER" || !risk.source_fill_ids.includes(f.id) || f.instrument_id!==trial.instrument_id)) throw new Error("DEMO_TRIAL_FILL_UNVERIFIED");
  const startedAt=new Date(trial.started_at).toISOString();
  const rates=await readBoundedPages<any>("demo-trial-fx",(from,to)=>db.from("fx_observations").select("*").eq("quote_currency","SEK")
    .gte("effective_at",new Date(Date.parse(startedAt)-7*86400000).toISOString()).lte("available_at",full.cutoffAt).order("effective_at").order("id").range(from,to));
  const ids=new Set(orders.map(o=>o.id)),position=full.positions.find(p=>p.instrumentId===trial.instrument_id);
  const market=full.demoReconciliation?.market, rate=full.demoReconciliation?.quoteSekRate;
  if (!market || !rate || full.demoReconciliation?.instrumentId!==trial.instrument_id) throw new Error("DEMO_TRIAL_MARK_UNKNOWN");
  const ledger=rebuildAccountLedgerV2({accountId:trial.account_id,baselineAt:startedAt,openingCashSek:200,openingCashStatus:"DECLARED",historyComplete:true,
    cutoffAt:full.cutoffAt,economicCutoffAt:full.economicCutoffAt,dailyWindowStartAt:full.dailyWindowStartAt,
    fills:fills.map(f=>normalizeLedgerFill(f,full.cutoffAt,rates).fill),
    pendingOrders:full.pendingOrders===null?null:full.pendingOrders.filter(o=>ids.has(o.orderId)),
    marks:[{instrumentId:trial.instrument_id,priceSek:position?.markPriceSek??market.bid*rate,observedAt:market.observedAt,availableAt:full.cutoffAt}]});
  const saved=await db.from("demo_trial_snapshots").insert({trial_id:trial.id,risk_snapshot_id:risk.id,ledger_payload:ledger}).select("id").single();
  if(saved.error)throw saved.error;
  return{snapshotId:saved.data.id,trialId:trial.id,actionId,accountId:trial.account_id,enabled:trial.enabled,
    riskSnapshotId:risk.id,startedAt,endsAt:trial.ends_at,instrumentId:trial.instrument_id,ledger};
}

export async function trialForAction(db:SupabaseClient,actionId:string){
  const action=await db.from("demo_trial_decisions").select("trial_id").eq("id",actionId).maybeSingle();
  if(action.error)throw action.error;
  if(!action.data)throw new Error("DEMO_TRIAL_ACTION_MISSING");
  const trial=await db.from("demo_trials").select("*").eq("id",action.data.trial_id).single();
  if(trial.error)throw trial.error;
  return trial.data;
}
