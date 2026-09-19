import type { SupabaseClient } from "@supabase/supabase-js";
import styles from "./execution.module.css";

export async function FlowStatus({db}:{db:SupabaseClient}) {
  const results=await Promise.all([
    db.from("trade_proposal_producer_evaluations").select("id",{head:true,count:"exact"}),
    db.from("trade_proposal_producer_evaluations").select("id",{head:true,count:"exact"}).eq("decision","REJECTED"),
    db.from("trade_eligibility_evaluations").select("id",{head:true,count:"exact"}),
    db.from("trade_eligibility_evaluations").select("id",{head:true,count:"exact"}).eq("decision","ELIGIBLE"),
  ]);
  const labels=["Kandidatbedömningar totalt","Avslag före proposal","Eligibility-bedömningar totalt","ELIGIBLE-bedömningar"];
  return <article className={styles.panel}>
    <header><div><small>ORDINARIE FORSKNINGSFLÖDE</small><h2>Vägen till en godkänd order</h2></div><span>{results.some(r=>r.error)?"OFULLSTÄNDIGT":"TOTAL HISTORIK"}</span></header>
    <div className={styles.reconcile}>{results.map((r,i)=><div key={labels[i]}><strong>{r.error?"Okänt":r.count??"Okänt"}</strong><span>{labels[i]}</span></div>)}</div>
    <p>Antalen gäller bedömningar, inte unika trades. Listorna längre ned visar endast de senaste 12.</p>
    <ol>
      <li>Opportunity måste vara qualified, Meta redo utan REJECT och konsensus stödja riktningen.</li>
      <li>Instrument, pris, FX, likviditet och tokenrisk måste vara kända och klara producentens krav.</li>
      <li>En skapad proposal måste klara Trade Eligibility: bland annat riktning, storlek, stop/target, risk och färsk data.</li>
      <li>Kontobindning, instrument, disponibelt kapital och slutliga orderspärrar måste också godkännas.</li>
    </ol>
    <p>ELIGIBLE är inget orderlöfte. Den ordinarie producenten bygger för närvarande USDT-par, medan demokontots exekveringsmarknad är BTC-EUR. En godkänd kandidat kräver därför även korrekt instrument- och valutakoppling innan detta konto kan användas. Kontots befintliga exponering ingår i ordinarie riskgränser.</p>
    <p>Experimentets affärer räknas inte som bevis för denna kedja eller som validerad strategiprestanda.</p>
  </article>;
}
