import Link from "next/link";
import { getOperatorSession, isOperatorAuthConfigured } from "@/lib/operator-session";
import { safeOperatorReturnPath } from "@/lib/operator-auth";
import { logoutOperator } from "./actions";
import { OperatorLoginForm } from "./login-form";
import styles from "./operator.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operatörsåtkomst · Market Intelligence", robots: { index: false, follow: false } };

export default async function OperatorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getOperatorSession();
  const nextPath = safeOperatorReturnPath((await searchParams).next);
  const configured = isOperatorAuthConfigured();
  return <main className={styles.page}><section className={styles.panel}>
    <small>SKYDDAD ARBETSYTA</small><h1>Operatörsåtkomst</h1>
    <p>Inloggning krävs för att starta jobb, spara research och visa kontodata. Publik research kan fortfarande läsas utan inloggning.</p>
    {session ? <>
      <p>Du är inloggad. Sessionen upphör {new Date(session.expiresAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })} Stockholm.</p>
      <Link href={nextPath}>Fortsätt till arbetsytan →</Link>
      <form action={logoutOperator} className={styles.form}><button type="submit">Logga ut</button></form>
    </> : <>
      {!configured && <p className={styles.notice}>Inloggning är avstängd tills serverns befintliga DATA_OPERATIONS_OPERATOR_TOKEN är konfigurerad med minst 32 tecken. Ingen åtkomst ges utan den.</p>}
      <OperatorLoginForm nextPath={nextPath} configured={configured} />
      <p className={styles.note}>Sessionen gäller i två timmar. Token lagras inte i webbläsaren och visas aldrig i sidans innehåll. Inloggning aktiverar inte livehandel.</p>
    </>}
    <Link href="/">← Till publik research</Link>
  </section></main>;
}
