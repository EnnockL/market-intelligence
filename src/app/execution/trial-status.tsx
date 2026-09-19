import type { SupabaseClient } from "@supabase/supabase-js";
import styles from "./execution.module.css";

export async function TrialStatus({db}:{db:SupabaseClient}){
  const config=await db.from("demo_trials").select("id,enabled,ends_at,label").limit(1).maybeSingle();
  if(config.error)return <p>Experimentstatus kunde inte hämtas.</p>;
  if(!config.data)return null;
  const trial=config.data;
  const [decision,snapshot,orders]=await Promise.all([
    db.from("demo_trial_decisions").select("decision,reason,created_at").eq("trial_id",trial.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("demo_trial_snapshots").select("ledger_payload,created_at").eq("trial_id",trial.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    db.from("demo_trial_orders").select("current_state,filled_quantity").eq("trial_id",trial.id).order("created_at",{ascending:false}).limit(10),
  ]);
  const ledger=snapshot.data?.ledger_payload,ended=Date.parse(trial.ends_at)<=Date.now(),incomplete=decision.error||snapshot.error||orders.error;
  const money=(n:unknown)=>typeof n==="number"?`${n.toLocaleString("sv-SE",{maximumFractionDigits:2})} kr`:"okänt";
  return <article className={styles.panel}>
    <header><div><small>ENDAST DEMOPENGAR · OVALIDERAD STRATEGI</small><h2>BTC-EUR-experiment</h2></div><span>{incomplete?"STATUS OFULLSTÄNDIG":!trial.enabled?"PAUSAT":ended?"ENDAST EXIT":"AKTIVERAT"}</span></header>
    <p>Egen testbudget: 200 kr. Högst 100 kr per order och en säljbar testposition åt gången. Gamla innehav ingår i kontots avstämning men kan inte säljas av experimentet.</p>
    <p>Testets exponering: {money(ledger?.grossExposureSek)}. Reserverat för köp: {money(ledger?.reservedBuySek)}. Realiserat testresultat: {money(ledger?.realizedPnlSek)}.</p>
    <p>Senaste beslut: {decision.data?`${decision.data.decision} – ${decision.data.reason}`:"inväntar första körning"}. Senaste order: {orders.data?.[0]?.current_state??"ingen order ännu"}.</p>
    <p>Köp kräver en positiv EMA/VWAP-signal. Flödet söker exit vid trendskifte, −5 %, +10 % eller efter 30 minuter. Exit prövas vid schemalagda körningar; prisgränserna är inte garanterade avslutspriser.</p>
    <p>Nya köp upphör {new Date(trial.ends_at).toLocaleString("sv-SE",{timeZone:"Europe/Stockholm"})} (Stockholm). Experimentet ger inget strategigodkännande och påverkar inte det separata framåttestet.</p>
  </article>;
}
