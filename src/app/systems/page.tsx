import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { SYSTEM_CATALOG } from "@/config/system-catalog";
import styles from "./systems.module.css";
export const dynamic="force-dynamic";

export default async function SystemsPage(){
  const db=createServiceClient();
  const [{data:jobs},{data:runs}]=await Promise.all([
    db.from("scheduled_jobs").select("job_type,status,last_successful_run_at,last_heartbeat_at,locked_at,enabled"),
    db.from("ingestion_runs").select("job_kind,status,records_processed,finished_at").order("started_at",{ascending:false}).limit(500),
  ]);
  const jobMap=new Map((jobs??[]).map((job:any)=>[job.job_type,job]));
  const runMap=new Map<string,any>();for(const run of runs??[])if(!runMap.has(run.job_kind))runMap.set(run.job_kind,run);
  const covered=SYSTEM_CATALOG.filter(item=>item.route&&item.backendJob).length;
  return <main className={styles.page}><section className={styles.hero}><small>SYSTEM COVERAGE</small><h1>Frontend ↔ Backend</h1><p>One truth map for every implemented pipeline. Scheduler state and latest persisted run are shown separately so an implemented system is never mistaken for a running one.</p><div><strong>{SYSTEM_CATALOG.length}</strong><span>systems mapped</span><strong>{covered}</strong><span>with backend + UI</span></div></section><section className={styles.panel}><header><span>System</span><span>Layer</span><span>Backend</span><span>Runtime state</span><span>Frontend</span></header>{SYSTEM_CATALOG.map(item=>{const job=item.schedulerType?jobMap.get(item.schedulerType):null;const run=item.backendJob?runMap.get(item.backendJob):null;const state=job?(job.locked_at?"RUNNING":job.status):run?.status?.toUpperCase()??"NOT RUN";const timestamp=job?.last_successful_run_at??run?.finished_at??null;return <article key={item.name}><div><strong>{item.name}</strong><small>{item.description}</small></div><b>{item.kind}</b><div><code>{item.backendJob??"—"}</code><small>{item.schedulerType??"MANUAL"}</small></div><div><em data-state={state}>{state}</em><small>{timestamp?new Date(timestamp).toLocaleString("sv-SE"):"No successful timestamp"}</small></div><Link href={item.route}><strong>{item.frontend}</strong><span>Open →</span></Link></article>})}</section></main>;
}
