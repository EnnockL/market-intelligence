import { Suspense, type ReactNode } from "react";
import styles from "./panel-loading.module.css";

export function DashboardPanel({ title, children, rows = 3 }: { title: string; children: ReactNode; rows?: number }) {
  // Keep the same reserved region when a skeleton resolves to a short empty or
  // error state. Long real lists may still grow; this is not a zero-CLS claim.
  return <div className={styles.region}>
    <Suspense fallback={<PanelLoading title={title} rows={rows} />}>{children}</Suspense>
  </div>;
}

export function PanelLoading({ title, rows = 3 }: { title: string; rows?: number }) {
  return <section className={styles.panel} role="status" aria-label={`${title} laddas`} aria-busy="true">
    <span className="eyebrow">HÄMTAR SPARAD DATA</span>
    <h2>{title}</h2>
    <p>Laddar den här panelen. Övriga delar av sidan kan användas under tiden.</p>
    <div className={styles.rows} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div className={styles.row} key={index} />)}
    </div>
  </section>;
}

export function PanelUnavailable({ title }: { title: string }) {
  return <section className={`${styles.panel} ${styles.error}`} role="alert">
    <span className="eyebrow">DATA EJ TILLGÄNGLIG</span>
    <h2>{title}</h2>
    <p>Den här panelen kunde inte laddas. Saknade uppgifter visas inte som noll eller som live-data. Försök ladda om sidan.</p>
  </section>;
}

// Each read belongs to its own Suspense boundary. A rejected data request must
// not remove unrelated panels or serialize provider error details to the page.
export async function DashboardSection<T>({ title, load, render }: {
  title: string;
  load: () => Promise<T>;
  render: (data: T) => ReactNode;
}) {
  try { return render(await load()); }
  catch { return <PanelUnavailable title={title} />; }
}
