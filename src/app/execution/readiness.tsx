import type { SupabaseClient } from "@supabase/supabase-js";
import { entryRiskSummary, prospectiveWindowSummary } from "@/domain/execution-readiness";
import styles from "./execution.module.css";

export async function ExecutionReadiness({ db, control }: { db: SupabaseClient; control: any }) {
  const [accounts, plans, pending] = await Promise.all([
    db.from("execution_accounts").select("id,account_key").eq("provider", control?.provider ?? "UNKNOWN").eq("provider_environment", control?.mode ?? "UNKNOWN").eq("status", "ACTIVE"),
    db.from("strategy_dataset_plans").select("asset_id,provider,ends_at,strategy_definition_id,strategy_definitions!inner(strategy_key,timeframe)").eq("strategy_definitions.strategy_key", "btc-eur-ema-vwap-prospective").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("wallet_rebuild_jobs").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
  ]);
  const account = accounts.data?.length === 1 ? accounts.data[0] : null;
  const plan = plans.data;
  const definition = Array.isArray(plan?.strategy_definitions) ? plan.strategy_definitions[0] : plan?.strategy_definitions;
  const [risk, runtime, candle] = await Promise.all([
    account ? db.from("risk_ledger_snapshots").select("status,ledger_payload,information_cutoff_at").eq("account_id", account.id).order("information_cutoff_at", { ascending: false }).limit(1).maybeSingle() : null,
    plan ? db.from("strategy_runtime_assessments").select("runtime_state,decision,available_at").eq("strategy_definition_id", plan.strategy_definition_id).order("information_cutoff_at", { ascending: false }).limit(1).maybeSingle() : null,
    plan ? db.from("market_candles").select("closed_at").eq("asset_id", plan.asset_id).eq("provider", plan.provider).eq("timeframe", definition?.timeframe ?? "5m").order("closed_at", { ascending: false }).limit(1).maybeSingle() : null,
  ]);
  const ledger = risk?.data?.ledger_payload;
  const limits = control?.limits ?? {};
  const exposure = typeof ledger?.grossExposureSek === "number" && typeof ledger?.reservedBuySek === "number" ? ledger.grossExposureSek + ledger.reservedBuySek : null;
  const timestamp = (value?: string) => value ? new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }) : "saknas";
  const unavailable = accounts.error || plans.error || pending.error || risk?.error || runtime?.error || candle?.error;
  return <article className={styles.panel}>
    <header><div><small>DRIFT OCH HANDELSSPÄRRAR</small><h2>Ordinarie orderflöde</h2></div><span>{unavailable ? "STATUS OFULLSTÄNDIG" : "SENAST REGISTRERAT"}</span></header>
    <p>{control?.mode === "DEMO" && control?.new_orders_enabled && !control?.kill_switch ? "Demohandel är aktiverad. Varje order prövas mot signal, konto och riskgränser." : "Orderflödet är inte aktiverat för demohandel."}</p>
    <p><strong>Konto: {account?.account_key ?? "kan inte fastställas entydigt"}.</strong> {entryRiskSummary({ status: risk?.data?.status, openPositions: ledger?.openPositions, exposureSek: exposure, maxPositions: limits.maxOpenPositions, maxExposureSek: limits.maxTotalExposureSek })}</p>
    <p>Riskbild från {timestamp(risk?.data?.information_cutoff_at)} (Stockholm). Gränser: {String(limits.maxOpenPositions ?? "okänt")} positioner, {String(limits.maxTotalExposureSek ?? "okänt")} SEK exponering. Färska konto- och marknadsuppgifter kontrolleras igen inför varje order.</p>
    <p><strong>BTC-EUR:</strong> {prospectiveWindowSummary(plan?.ends_at ?? null)} Senaste femminutersstapel stängde {timestamp(candle?.data?.closed_at)} (Stockholm).</p>
    <p>Senaste registrerade strategibeslut: {runtime?.data ? `${runtime.data.runtime_state} / ${runtime.data.decision}` : "inget beslut finns"}. Ett avslutat test ger inte automatiskt rätt att handla.</p>
    <p>Wallet-historik: {pending.error ? "status kunde inte läsas" : `${pending.count ?? 0} beräkningar pågår`}. Resultat publiceras först när hela respektive wallet är färdigberäknad.</p>
    {unavailable && <p>Delar av statusen kunde inte hämtas. Saknade uppgifter innebär inget godkännande.</p>}
  </article>;
}
