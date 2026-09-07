"use client";

import styles from "./data-collection.module.css";

export default function DataCollectionError({ retry }: { retry: () => void }) {
  return <main className={styles.page}><section className={styles.panel}>
    <div className={styles.readError} role="alert">
      <h1>Data Operations kunde inte laddas</h1>
      <p>Detta är ett laddfel, inte ett besked om att datan saknas. Inga jobb eller orders har startats.</p>
      <button type="button" onClick={() => retry()}>Försök igen</button>
    </div>
  </section></main>;
}
