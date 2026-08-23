import { createServiceClient } from "@/lib/supabase/server";
import styles from "./data-collection.module.css";
export const dynamic = "force-dynamic";

export default async function DataCollectionPage() {
  const db = createServiceClient(), today = new Date().toISOString().slice(0, 10), now = new Date().toISOString();
  const [{ data: jobs }, { data: forecasts }, { data: outcomes }, { data: groups }, { data: buckets }, { data: readiness }] = await Promise.all([
    db.from("scheduled_jobs").select("*").order("job_key"), db.from("forecasts").select("id,created_at").gte("created_at", `${today}T00:00:00Z`),
    db.from("forecast_outcomes").select("status,forecasts!inner(horizon)").gte("created_at", `${today}T00:00:00Z`), db.from("forecast_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(12),
    db.from("forecast_calibration_buckets").select("*").order("created_at", { ascending: false }).limit(100), db.from("meta_readiness_snapshots").select("*,meta_readiness_requirements(*)").lte("available_at", now).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const completed = (horizon: string) => (outcomes ?? []).filter((item: any) => relation(item.forecasts)?.horizon === horizon && item.status === "AVAILABLE").length;
  return <main className={styles.page}>
    <section className={styles.hero}><small>FORECAST OPERATIONS</small><h1>Data Collection</h1><p>Continuous baseline creation, outcome completion and calibration readiness.</p></section>
    <section className={styles.grid}><Stat label="Forecasts created today" value={forecasts?.length ?? 0}/>{["5m", "30m", "2h", "24h"].map((horizon) => <Stat key={horizon} label={`${horizon} outcomes completed`} value={completed(horizon)}/>)}</section>
    <section className={styles.panel}><small>META READINESS</small><div className={styles.groups}>{readiness ? <><article className={styles.group}><h3>{readiness.status}</h3><p>{readiness.assessment_count}/30 assessments · decision coverage {readiness.decision_coverage_pct === null ? "UNKNOWN" : `${Number(readiness.decision_coverage_pct).toFixed(0)}%`}</p><strong>{readiness.policy_version}</strong></article>{(readiness.meta_readiness_requirements ?? []).map((item: any) => <article className={styles.group} key={item.id}><h3>{item.requirement_code}</h3><p>{item.reason ?? "Requirement satisfied"}</p><strong className={(styles as any)[item.status === "PASS" ? "healthy" : item.status === "UNKNOWN" ? "degraded" : "failed"]}>{item.status}</strong></article>)}</> : <p>No readiness snapshot yet.</p>}</div></section>
    <section className={styles.panel}><small>SCHEDULER HEALTH</small><div className={styles.jobs}>{(jobs ?? []).map((job: any) => <article className={styles.job} key={job.id}><h3>{job.job_key}</h3><strong className={(styles as any)[String(job.status).toLowerCase()]}>{job.status}</strong><p>Last success {job.last_successful_run_at ? new Date(job.last_successful_run_at).toLocaleString("sv-SE") : "NEVER"}</p><p>Failures {job.consecutive_failures} · next {new Date(job.next_run_at).toLocaleTimeString("sv-SE")}</p></article>)}</div></section>
    <section className={styles.panel}><small>PERFORMANCE READINESS</small><div className={styles.groups}>{(groups ?? []).map((group: any) => <article className={styles.group} key={group.id}><h3>{group.forecast_method} · {group.horizon}</h3><p>{group.sample_size}/30 outcomes</p><strong>{group.sample_size >= 30 ? "READY" : "COLLECTING"}</strong></article>)}</div><p>Calibration bucket samples stored: {(buckets ?? []).reduce((sum: number, item: any) => sum + item.sample_size, 0)}</p></section>
  </main>;
}
function Stat({ label, value }: { label: string; value: number }) { return <article className={styles.stat}><span>{label}</span><strong>{value}</strong></article>; }
function relation(value: any) { return Array.isArray(value) ? value[0] : value; }
