"use client";

import Link from "next/link";
import styles from "@/components/dashboard/panel-loading.module.css";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main>
    <section className="hero"><div><span className="eyebrow">SIDAN KUNDE INTE LADDAS</span><h1>Försök igen</h1><p>Informationen kunde inte hämtas eller visas. Menyn fungerar fortfarande. Vi visar inga ersättningsresultat.</p></div></section>
    <div className={styles.panel} role="alert">
      <p>Att ladda om vyn startar inte en ny simulering, import eller order.</p>
      <button type="button" className={styles.retry} onClick={() => retry()}>Försök ladda sidan igen</button>
      <p><Link className={styles.link} href="/">Till Market Radar →</Link></p>
    </div>
  </main>;
}
