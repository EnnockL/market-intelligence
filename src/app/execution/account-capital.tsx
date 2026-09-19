import type { SupabaseClient } from "@supabase/supabase-js";
import styles from "./execution.module.css";

export async function AccountCapital({db, risk}:{db:SupabaseClient;risk:any}) {
  const account = risk?.account_id ? await db.from("execution_accounts").select("account_key").eq("id",risk.account_id).maybeSingle() : null;
  const captureId = risk?.demo_capture_id;
  const capture = captureId ? await db.from("demo_account_captures").select("record").eq("id",captureId).eq("account_id",risk.account_id).maybeSingle() : null;
  const evidence = capture?.data?.record?.evidence;
  const quote = evidence?.quoteCurrency;
  const balance = evidence?.balances?.find((b:any)=>b.currency===quote);
  const valid = risk?.status==="KNOWN" && !capture?.error && !!evidence;
  const amount = (v:unknown,c:string) => v!==null && v!==undefined && Number.isFinite(Number(v)) ? `${Number(v).toLocaleString("sv-SE",{maximumFractionDigits:2})} ${c}` : "Okänt";
  return <article className={styles.panel}>
    <header><div><small>ACCOUNT STATE · SAMMA AVSTÄMNING SOM RISK LEDGER</small><h2>Kontots handelskapital</h2></div><span>{risk?.status??"SAKNAS"}</span></header>
    <div className={styles.reconcile}>
      <div><strong>{account?.data?.account_key??"Okänt konto"}</strong><span>Konto</span></div>
      <div><strong>{valid?amount(balance?.available,quote):"Okänt"}</strong><span>Tillgänglig handelsvaluta hos börsen</span></div>
      <div><strong>{valid?amount(risk.available_cash_sek,"SEK"):"Okänt"}</strong><span>Tillgängligt enligt riskledger</span></div>
    </div>
    <p>Handelsvalutan är {quote??"okänd"}. SEK-beloppet använder avstämningens valutakurs. Övriga innehav är inte disponibel handelsvaluta. Experimentets egen budget är 200 kr.</p>
    <p>Total kontoequity i USD rapporteras inte i denna avstämning. Det är ett separat mått, inte ett saknat kontosaldo.</p>
    <p>Avstämning: {risk?.information_cutoff_at?new Date(risk.information_cutoff_at).toLocaleString("sv-SE",{timeZone:"Europe/Stockholm"}):"saknas"} (Stockholm). {capture?.error||account?.error?"Kontouppgifter kunde inte hämtas.":null}</p>
  </article>;
}
