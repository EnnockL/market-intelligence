import { createServiceClient } from "@/lib/supabase/server";
import styles from "./strategy-lab.module.css";

export const dynamic = "force-dynamic";
export default async function StrategyLabPage() {
  const db = createServiceClient();
  const [{ data: runs }, { data: definitions }] = await Promise.all([
    db.from("strategy_evaluation_runs").select("*,assets(symbol),strategy_definitions(name,strategy_key,version,timeframe)").order("created_at", { ascending: false }).limit(30),
    db.from("strategy_definitions").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  return <main className={styles.page}>
    <section className={styles.hero}><p>DETERMINISTIC RESEARCH</p><h1>Strategy Pattern Lab</h1><span>Versionerade setups, point-in-time candles och reproducerbar performance. Inga live-order.</span></section>
    <section className={styles.summary}><Metric label="Strategies" value={String(definitions?.length ?? 0)}/><Metric label="Evaluation runs" value={String(runs?.length ?? 0)}/><Metric label="Execution" value="DISABLED"/></section>
    <section className={styles.panel}><header><div><p>IMMUTABLE RESULTS</p><h2>Historical evaluations</h2></div><span>Minsta sample size styr om procenttal visas</span></header>
      {runs?.length ? <div className={styles.grid}>{runs.map((run: any) => <article key={run.id}><small>{asset(run.assets)} · {run.strategy_definitions?.timeframe} · v{run.strategy_definitions?.version}</small><h3>{run.strategy_definitions?.name}</h3><div className={styles.metrics}><Metric label="Status" value={run.status}/><Metric label="Samples" value={`${run.sample_size}/${run.minimum_sample_size}`}/><Metric label="Win rate" value={metric(run.metrics?.winRate, "%")}/><Metric label="Profit factor" value={metric(run.metrics?.profitFactor)}/><Metric label="Average R" value={metric(run.metrics?.averageR)}/><Metric label="Max DD (R)" value={metric(run.metrics?.maxDrawdownR)}/></div><footer>Cutoff {new Date(run.information_cutoff_at).toLocaleString("sv-SE")} · candles {run.candle_count} · trades {run.trade_count}</footer></article>)}</div> : <div className={styles.empty}><strong>INSUFFICIENT DATA</strong><span>Inga historiska candle-dataset har utvärderats ännu. Systemet visar inte påhittade resultat.</span></div>}
    </section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
function metric(value: unknown, suffix = "") { const number = Number(value); return value === null || value === undefined || !Number.isFinite(number) ? "INSUFFICIENT DATA" : `${number.toFixed(2)}${suffix}`; }
function asset(value: any) { return Array.isArray(value) ? value[0]?.symbol ?? "UNKNOWN" : value?.symbol ?? "UNKNOWN"; }
