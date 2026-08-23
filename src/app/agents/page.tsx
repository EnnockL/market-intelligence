import { createServiceClient } from "@/lib/supabase/server";
import styles from "./agents.module.css";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const db = createServiceClient();
  const now = new Date().toISOString();
  const [{ data: analyses }, { data: performance }, { data: regimes }] = await Promise.all([
    db.from("specialist_analyses").select("*,assets(symbol),specialist_analysis_components(*)").order("created_at", { ascending: false }).limit(100),
    db.from("agent_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("market_regime_snapshots").select("*").lte("available_at", now).order("created_at", { ascending: false }).limit(2),
  ]);
  return <main className={styles.page}>
    <section className={styles.hero}><small>DETERMINISTIC SPECIALISTS</small><h1>Agent Center</h1><p>Point-in-time specialist analyses with explicit evidence and knowledge traces. No autonomous execution.</p></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><small>MARKET REGIME</small><div className={styles.grid}>{(regimes ?? []).map((item: any) => <article className={styles.card} key={item.id}><small>{item.scope} · {item.policy_version}</small><h3>{item.regime}</h3><p>{item.reason ?? "Deterministic breadth confirmed"} · coverage {Number(item.coverage_pct).toFixed(0)}%</p></article>)}{!regimes?.length && <p>Market regime has not been observed yet.</p>}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><small>MEASURED CONTRIBUTION</small><div className={styles.grid}>
      {(performance ?? []).map((item: any) => <article className={styles.card} key={item.id}>
        <small>{item.agent_id} · {item.horizon} · {item.market_regime}</small>
        <h3>{item.independent_edge === "NOT_PROVEN" ? "NOT PROVEN" : `${item.independent_edge} EDGE`}</h3>
        <p>{item.status} · {item.directional_sample_size}/30 directional samples</p>
        <div className={styles.components}><span>{metric(item.metrics?.directionalAccuracy, "Accuracy")}</span><span>{metric(item.metrics?.incrementalValue, "Incremental")}</span><span>{metric(item.metrics?.overlapPenalty, "Overlap penalty")}</span></div>
      </article>)}
      {!performance?.length && <p>No agent performance snapshots yet.</p>}
    </div></section>
    <section className={styles.panel}><small>LATEST ANALYSES</small><div className={styles.grid}>{(analyses ?? []).map((analysis: any) => <article className={styles.card} key={analysis.id}><small>{analysis.specialist} · {asset(analysis.assets)}</small><h3>{analysis.conclusion}</h3><p>Quality {analysis.data_quality ?? "UNKNOWN"} · knowledge {analysis.knowledge_rule_refs?.length ?? 0} rules</p><div className={styles.components}>{(analysis.specialist_analysis_components ?? []).map((component: any) => <span className={(styles as any)[component.status.toLowerCase()]} key={component.id}>{component.component_code}: {component.status}</span>)}</div></article>)}</div></section>
  </main>;
}
function asset(value: any) { const item = Array.isArray(value) ? value[0] : value; return item?.symbol ?? "UNKNOWN"; }
function metric(value: any, label: string) { return value?.status === "VALUE" ? `${label} ${value.value.toFixed(1)}%` : `${label} UNKNOWN`; }
