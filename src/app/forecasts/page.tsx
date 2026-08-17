import { createServiceClient } from "@/lib/supabase/server";
import styles from "./forecasts.module.css";
export const dynamic = "force-dynamic";

export default async function ForecastsPage() {
  const db = createServiceClient();
  const [{ data: forecasts }, { data: catalysts }, { data: performance }] = await Promise.all([
    db.from("forecasts").select("*,assets(symbol),forecast_outcomes(*)").order("created_at", { ascending: false }).limit(100),
    db.from("catalysts").select("*,assets(symbol),catalyst_revisions(*)").order("created_at", { ascending: false }).limit(50),
    db.from("forecast_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(12),
  ]);
  return <main className={styles.page}>
    <section className={styles.hero}><p>FORWARD RESEARCH</p><h1>Forecasts & Catalysts</h1><span>Deterministic baselines and measured calibration. No BUY/SELL decisions.</span></section>
    <section className={styles.panel}><header><div><p>MODEL DIAGNOSTICS</p><h2>Performance & Calibration</h2></div><span>{performance?.length ?? 0} immutable snapshots</span></header>{performance?.length ? <div className={styles.cards}>{performance.map((p:any) => <article key={p.id}><small>{p.forecast_method} · {p.horizon} · {p.data_quality_bucket}</small><h3>{p.status}</h3><p>Outcomes {p.sample_size}/30 · probability sample {p.probability_sample_size}/30</p><footer>{metric(p.metrics?.directionalAccuracy, "Directional accuracy")} · {metric(p.metrics?.brierScore, "Brier")}</footer></article>)}</div> : <div className={styles.empty}>No performance snapshots yet.</div>}</section>
    <section className={styles.panel}><header><div><p>FORECAST RECORDS</p><h2>Forecasts</h2></div><span>{forecasts?.length ?? 0} records</span></header><div className={styles.table}><b>Asset</b><b>Horizon</b><b>Method</b><b>Status</b><b>Outcome</b><b>Quality</b>{(forecasts ?? []).map((f:any) => <div className={styles.row} key={f.id}><strong>{asset(f.assets)}</strong><span>{f.horizon}</span><span>{f.forecast_method}</span><em data-status={f.status}>{f.status}</em><span>{f.forecast_outcomes?.[0]?.status ?? "PENDING"}</span><span>{f.data_quality ?? "UNKNOWN"}</span></div>)}</div></section>
    <section className={styles.panel}><header><div><p>ACTIVE INFORMATION</p><h2>Catalyst Watch</h2></div><span>{catalysts?.length ?? 0} catalysts</span></header>{catalysts?.length ? <div className={styles.cards}>{catalysts.map((c:any) => <article key={c.id}><small>{asset(c.assets)} · {c.catalyst_type}</small><h3>{c.current_state}</h3><p>{c.materiality} materiality · {c.source_classification}</p><footer>Watch until {new Date(c.watch_until).toLocaleString("sv-SE")} · revision {c.current_revision}</footer></article>)}</div> : <div className={styles.empty}>Inga verifierbara catalysts har ingestats ännu. Systemet hittar inte på exempeldata.</div>}</section>
  </main>;
}
function asset(value:any){const row=Array.isArray(value)?value[0]:value;return row?.symbol ?? "UNKNOWN";}
function metric(value:any,label:string){return value?.status === "VALUE" ? `${label} ${Number(value.value).toFixed(2)}` : `${label} UNKNOWN`;}
