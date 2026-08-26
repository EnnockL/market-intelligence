import { createServiceClient } from "@/lib/supabase/server";
import styles from "./strategy-validation.module.css";

export const dynamic = "force-dynamic";
export default async function StrategyValidationPage() {
  const db = createServiceClient();
  const [validations, runtime, hypotheses, protocols] = await Promise.all([
    db.from("strategy_validation_runs").select("*,strategy_definitions(name,strategy_key,version)").order("created_at", { ascending: false }).limit(30),
    db.from("strategy_runtime_assessments").select("*,strategy_definitions(name,strategy_key,version)").order("created_at", { ascending: false }).limit(30),
    db.from("strategy_hypotheses").select("id", { count: "exact", head: true }),
    db.from("strategy_validation_protocols").select("protocol_key,version,status").eq("status", "ACTIVE").order("version", { ascending: false }).limit(1),
  ]);
  const validationRows:any[]=validations.data??[], runtimeRows:any[]=runtime.data??[], latestValidation=validationRows[0], latestRuntime=runtimeRows[0], activeProtocol:any=protocols.data?.[0];
  return <main className={styles.page}>
    <section className={styles.hero}><p>VALIDATION CONTROL PLANE</p><h1>Prove the edge.<br/>Then protect it.</h1><span>Immutable learning windows, honest out-of-sample evidence and runtime governance with NO_TRADE as default.</span></section>
    <section className={styles.summary}><Metric label="Active protocol" value={activeProtocol?`${activeProtocol.protocol_key} v${activeProtocol.version}`:"NOT APPLIED"}/><Metric label="Hypotheses" value={String(hypotheses.count??0)}/><Metric label="Validation runs" value={String(validationRows.length)}/><Metric label="Runtime default" value="NO_TRADE"/></section>
    <section className={styles.grid}><article className={styles.panel}><header><div><p>VALIDATION LIFECYCLE</p><h2>Learning to limited live</h2></div></header><div className={styles.timeline}>{["LEARNING","FROZEN","OUT_OF_SAMPLE","DEMO_VALIDATION","APPROVED_SHADOW","LIVE_LIMITED"].map((phase,index)=><div key={phase}><b>{String(index+1).padStart(2,"0")}</b><span>{phase.replaceAll("_"," ")}</span></div>)}</div><footer>No phase can silently skip its predecessor.</footer></article>
    <article className={styles.panel}><header><div><p>LATEST DECISION</p><h2>{latestValidation?.decision??"INSUFFICIENT_DATA"}</h2></div></header>{latestValidation?<GateList gates={latestValidation.gates}/>:<Empty text="No immutable validation run exists yet."/>}<footer>{latestValidation?`Cutoff ${date(latestValidation.information_cutoff_at)}`:"Apply migration 0071 and register a hypothesis."}</footer></article></section>
    <section className={styles.panel}><header><div><p>RUNTIME GOVERNANCE</p><h2>{latestRuntime?.decision??"NO_TRADE"}</h2></div><span>{latestRuntime?.runtime_state??"RESEARCH"}</span></header>{latestRuntime?<div className={styles.runtime}><GateList gates={latestRuntime.gates}/><div className={styles.diagnostics}><Metric label="Edge decay" value={latestRuntime.edge_decay?.status??"UNKNOWN"}/><Metric label="Correlation" value={number(latestRuntime.correlation_assessment?.value)}/><Metric label="Coverage" value={percent(latestRuntime.correlation_assessment?.coverage)}/><Metric label="Risk of ruin" value={percent(latestRuntime.risk_diagnostics?.riskOfRuin)}/><Metric label="Kelly cap" value={percent(latestRuntime.risk_diagnostics?.fractionalKellyCap)}/><Metric label="Revalidation" value={latestRuntime.revalidation_required?"REQUIRED":"NO"}/></div></div>:<Empty text="No runtime assessment exists. Missing evidence remains UNKNOWN and trading remains blocked."/>}</section>
    <section className={styles.panel}><header><div><p>IMMUTABLE HISTORY</p><h2>Validation evidence</h2></div></header>{validationRows.length?<div className={styles.history}>{validationRows.map(row=><div key={row.id}><span><b>{relation(row.strategy_definitions)?.name??"Unknown strategy"}</b><small>{row.phase} · cutoff {date(row.information_cutoff_at)}</small></span><strong data-decision={row.decision}>{row.decision}</strong></div>)}</div>:<Empty text="Runs appear here after a registered hypothesis is evaluated against a frozen dataset."/>}</section>
  </main>;
}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><small>{label}</small><strong>{value}</strong></div>}
function GateList({gates}:{gates:any[]}){return <div className={styles.gates}>{(gates??[]).map(gate=><div key={gate.code}><span>{gate.code.replaceAll("_"," ")}</span><b data-status={gate.status}>{gate.status}</b></div>)}</div>}
function Empty({text}:{text:string}){return <div className={styles.empty}>{text}</div>}
function relation(value:any){return Array.isArray(value)?value[0]:value} function date(value:string){return new Date(value).toLocaleString("sv-SE")}
function number(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)?parsed.toFixed(2):"UNKNOWN"} function percent(value:unknown){const parsed=Number(value);return value!==null&&value!==undefined&&Number.isFinite(parsed)?`${(parsed*100).toFixed(2)}%`:"UNKNOWN"}
