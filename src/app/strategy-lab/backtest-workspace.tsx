"use client";

import { useActionState } from "react";
import { runBacktest, syncCandleSource, type LabActionState } from "./actions";
import styles from "./backtest-workspace.module.css";

const initial: LabActionState = { status: "IDLE", message: "" };
export function BacktestWorkspace({ definitions, assets, sources }: { definitions: Array<{ id:string; name:string; timeframe:string }>; assets:Array<{ id:string; symbol:string; kind:string }>; sources:Array<{ id:string; label:string; status:string }> }) {
  const [runState, runAction, runPending] = useActionState(runBacktest, initial), [syncState, syncAction, syncPending] = useActionState(syncCandleSource, initial);
  const today = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  return <div className={styles.workspaceGrid}>
    <form action={runAction} className={styles.controlCard}>
      <div className={styles.cardHeader}><small>BACKTEST</small><h3>Run historical evaluation</h3><p>Testa en låst regelversion mot point-in-time marknadsdata.</p></div>
      <div className={styles.fieldGrid}>
        <label>Strategy<select name="definitionId" required>{definitions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.timeframe}</option>)}</select></label>
        <label>Asset<select name="assetId" required>{assets.map(item => <option key={item.id} value={item.id}>{item.symbol} · {item.kind}</option>)}</select></label>
      </div>
      <div className={styles.dateRow}><label>From<input name="startsAt" type="date" defaultValue={start} required/></label><label>To<input name="endsAt" type="date" defaultValue={today} required/></label></div>
      {!assets.length ? <p className={styles.actionError}>Ingen asset har en aktiv candle-källa. Kontrollera Historical Data nedan.</p> : null}
      <button className={styles.primaryAction} disabled={runPending || !assets.length}>{runPending ? "Running…" : "Run deterministic backtest"}</button><ActionMessage state={runState}/>
    </form>
    <form action={syncAction} className={styles.controlCard}>
      <div className={styles.cardHeader}><small>DATA IMPORT</small><h3>Sync historical candles</h3><p>Hämta nästa verifierbara datapaket från den konfigurerade providern.</p></div>
      <label>Configured source<select name="sourceId" required>{sources.map(item => <option key={item.id} value={item.id}>{item.label} · {item.status}</option>)}</select></label>
      <div className={styles.infoBox}><span>BOUNDED INGESTION</span><p>Max tre providersidor per körning. Importen sparar sin cursor och kan återupptas säkert.</p></div>
      <button className={styles.secondaryAction} disabled={syncPending || !sources.length}>{syncPending ? "Importing…" : "Import next candle batch"}</button><ActionMessage state={syncState}/>
    </form>
  </div>;
}
function ActionMessage({ state }: { state: LabActionState }) { return state.message ? <output className={state.status === "ERROR" ? styles.actionError : styles.actionSuccess}>{state.message}</output> : null; }
