import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import styles from "./agents.module.css";
import "./agents-operations.css";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const db = createServiceClient();
  const now = new Date().toISOString();
  const [{ data: analyses }, { data: performance }, { data: regimes }, { data: meta }, { data: explanations }, { data: jobs }, { data: runs }] = await Promise.all([
    db.from("specialist_analyses").select("*,assets(symbol),specialist_analysis_components(*)").order("created_at", { ascending: false }).limit(100),
    db.from("agent_performance_snapshots").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("market_regime_snapshots").select("*").lte("available_at", now).order("created_at", { ascending: false }).limit(2),
    db.from("meta_assessments").select("*,assets(symbol),meta_assessment_requirements(*)").lte("available_at", now).order("created_at", { ascending: false }).limit(12),
    db.from("ai_explanations").select("*,assets(symbol)").lte("available_at", now).order("created_at", { ascending: false }).limit(20),
    db.from("scheduled_jobs").select("*").order("priority", { ascending: true }),
    db.from("scheduled_job_runs").select("*").order("started_at", { ascending: false }).limit(100),
  ]);
  const latestRuns = new Map<string, any>();
  for (const run of runs ?? []) if (!latestRuns.has(run.job_id)) latestRuns.set(run.job_id, run);
  return <main className={styles.page}>
    <section className={styles.hero}><small>AGENT OPERATIONS</small><h1>Agent Center</h1><p>See what is implemented, scheduled, currently running and when each background pipeline last succeeded. No autonomous execution.</p></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><div className="agent-panel-title"><div><small>BACKGROUND WORKERS</small><h2>Operational status</h2></div><span>{jobs?.length ?? 0} scheduled pipelines</span></div><div className="agent-operations">{(jobs ?? []).map((job: any) => {const run=latestRuns.get(job.id);const running=Boolean(job.locked_at)&&run?.status==="RUNNING";const state=!job.enabled?"PAUSED":running?"RUNNING":job.status;return <article className="agent-job" key={job.id}><div><i className={`agent-dot agent-${state.toLowerCase()}`}/><span><strong>{friendly(job.job_type)}</strong><small>{job.job_key}</small></span><b className={`agent-${state.toLowerCase()}`}>{state}</b></div><dl><dt>Last success</dt><dd>{time(job.last_successful_run_at)}</dd><dt>Last heartbeat</dt><dd>{time(job.last_heartbeat_at)}</dd><dt>Latest records</dt><dd>{run?.records_processed??"—"}</dd><dt>Next run</dt><dd>{time(job.next_run_at)}</dd></dl>{job.last_error&&<p className="agent-error">{job.last_error}</p>}</article>})}{!jobs?.length&&<p>No scheduler records found. Apply scheduler migrations before expecting background agents to run.</p>}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><div className="agent-panel-title"><div><small>AGENT NETWORK</small><h2>Specialist coverage</h2></div><span>Output is never invented</span></div><div className="agent-catalog">{AGENTS.map((name)=>{const latest=(analyses??[]).find((item:any)=>item.specialist===name.code);return <article className="agent-card" key={name.code}><small>{name.layer}</small><h3>{name.label}</h3><p>{latest?`Latest output ${time(latest.created_at)}`:"No persisted output yet"}</p><span className={latest?"agent-available":"agent-no-output"}>{latest?"OUTPUT AVAILABLE":"NO RECENT OUTPUT"}</span></article>})}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><div className="agent-panel-title"><div><small>RESEARCH ENGINES</small><h2>Simulation and validation</h2></div><span>Deterministic infrastructure</span></div><div className="agent-catalog">{SYSTEMS.map((system)=>{const jobType="jobType" in system?system.jobType:null;const job=jobType?(jobs??[]).find((item:any)=>item.job_type===jobType):null;const state=job?job.status:"MANUAL";return <Link className="agent-card" href={system.href} key={system.label}><small>{system.layer}</small><h3>{system.label}</h3><p>{system.description}</p><span className={state==="HEALTHY"?"agent-available":"agent-no-output"}>{state}</span></Link>})}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><small>MARKET REGIME</small><div className={styles.grid}>{(regimes ?? []).map((item: any) => <article className={styles.card} key={item.id}><small>{item.scope} · {item.policy_version}</small><h3>{item.regime}</h3><p>{item.reason ?? "Deterministic breadth confirmed"} · coverage {Number(item.coverage_pct).toFixed(0)}%</p></article>)}{!regimes?.length && <p>Market regime has not been observed yet.</p>}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><small>META FOUNDATION</small><div className={styles.grid}>{(meta ?? []).map((item: any) => <article className={styles.card} key={item.id}><small>{asset(item.assets)} · {item.horizon} · {item.policy_version}</small><h3>{item.decision}</h3><p>{item.reason ?? "Requirements evaluated"} · ready {item.ready_for_policy_evaluation ? "YES" : "NO"}</p><div className={styles.components}>{(item.meta_assessment_requirements ?? []).map((requirement: any) => <span className={(styles as any)[requirement.status.toLowerCase()]} key={requirement.id}>{requirement.requirement_code}: {requirement.status}</span>)}</div></article>)}{!meta?.length && <p>No Meta Agent assessments yet.</p>}</div></section>
    <section className={styles.panel} style={{ marginBottom: 24 }}><div className="agent-panel-title"><div><small>OPENAI EXPLANATIONS</small><h2>Traceable reasoning</h2></div><span>Explanation only · no execution</span></div><div className={styles.grid}>{(explanations ?? []).map((item: any) => <article className={styles.card} key={item.id}><small>{asset(item.assets)} · {item.model} · {item.prompt_version}</small><h3>{item.suggested_action.replaceAll("_", " ")}</h3><p>{item.summary}</p><div className={styles.components}><span>Evidence {item.evidence_refs?.length ?? 0}</span><span>Cutoff {time(item.information_cutoff_at)}</span><span>Tokens {item.usage?.totalTokens ?? "UNKNOWN"}</span></div></article>)}{!explanations?.length && <p>No OpenAI explanations yet. Add the server-only key, apply migration 0051 and enable the AI_EXPLANATION scheduler job.</p>}</div></section>
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
const stockholmDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function time(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : `${stockholmDateTime.format(date)} Stockholm`;
}
function friendly(value:string){return value.toLowerCase().split("_").map((part)=>part[0].toUpperCase()+part.slice(1)).join(" ");}
const AGENTS=[{code:"MOMENTUM",label:"Momentum Agent",layer:"SPECIALIST"},{code:"FUNDAMENTAL",label:"Fundamental Agent",layer:"SPECIALIST"},{code:"TECHNICAL_STRUCTURE",label:"Technical Structure",layer:"SPECIALIST"},{code:"TIME_SESSION",label:"Time & Session",layer:"CONTEXT"},{code:"TOKEN_RISK",label:"Token Risk Agent",layer:"SAFETY"},{code:"SMART_MONEY",label:"Smart Money Agent",layer:"ON-CHAIN"},{code:"CATALYST",label:"Catalyst Agent",layer:"INFORMATION"},{code:"CONSENSUS",label:"Consensus Engine",layer:"SYNTHESIS"},{code:"META",label:"Meta Agent",layer:"CONTROL"},{code:"FORECAST",label:"Forecast Agent",layer:"FORECAST"}] as const;
const SYSTEMS=[{label:"Simulation Engine",layer:"BACKTEST",href:"/simulation",description:"Point-in-time capital, fees, slippage, liquidity and policy comparison."},{label:"Historical Replay",layer:"REPLAY",href:"/replay",description:"Reconstructs only information available at the selected historical cutoff."},{label:"Strategy Pattern Lab",layer:"RESEARCH",href:"/strategy-lab",description:"Tests immutable technical strategy definitions on historical candles."},{label:"Performance Engine",layer:"MEASUREMENT",href:"/paper",description:"Measures policy funnels, fills, PnL and blockers.",jobType:"AGENT_PERFORMANCE"},{label:"Forecast Calibration",layer:"FORECAST",href:"/forecasts",description:"Tracks forecast outcomes and calibration without invented probabilities.",jobType:"FORECAST_PERFORMANCE"}] as const;
