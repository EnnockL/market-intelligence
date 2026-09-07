"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runBacktest, syncCandleSource, type LabActionState } from "./actions";
import { initialLabValues, isLabRunId, labWorkspaceUrl, requestedLabRun, resolveLabResult, type LabFormValues, type LabResultRead } from "./lab-workspace-state";
import { invokeLabAction } from "./lab-action-client";
import { LabResultPanels } from "./lab-result-panels";
import panel from "./strategy-lab.module.css";
import styles from "./backtest-workspace.module.css";

const initial: LabActionState = { status: "IDLE", message: "" };
export interface BacktestWorkspaceProps {
  definitions: Array<{ id: string; name: string; timeframe: string }>;
  assets: Array<{ id: string; symbol: string; kind: string }>;
  sources: Array<{ id: string; label: string; status: string }>;
  runs: Array<{ id: string; label: string }>;
  initialValues: LabFormValues;
  requestedRunId: string | null;
  result: LabResultRead;
}

export function BacktestWorkspace({ definitions, assets, sources, runs, initialValues, requestedRunId, result }: BacktestWorkspaceProps) {
  const router = useRouter();
  const detailId = useId();
  const [values, setValues] = useState(initialValues);
  const [selectedRunId, setSelectedRunId] = useState(requestedRunId);
  const [attemptFailed, setAttemptFailed] = useState(false);
  const lastServerRun = useRef(requestedRunId);
  const initialDefaults = useRef(initialValues);
  useEffect(() => {
    const restoreHistory = () => {
      const search = Object.fromEntries(new URLSearchParams(window.location.search));
      setValues(initialLabValues(search, initialDefaults.current));
      setSelectedRunId(requestedLabRun(search));
      setAttemptFailed(false);
    };
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, []);
  // Browser navigation can change the selected result. Routine revalidation
  // with the same run ID must not overwrite the user's in-progress form edits.
  useEffect(() => {
    if (lastServerRun.current !== requestedRunId) {
      lastServerRun.current = requestedRunId;
      setSelectedRunId(requestedRunId);
      setAttemptFailed(false);
    }
  }, [requestedRunId]);

  const [runState, runAction, runPending] = useActionState(async (previous: LabActionState, form: FormData) => {
    setAttemptFailed(false);
    const state = await invokeLabAction(runBacktest, previous, form);
    if ((state.status === "SUCCESS" || state.status === "WARNING") && isLabRunId(state.runId)) {
      setSelectedRunId(state.runId);
      const submitted = { ...values, definitionId: String(form.get("definitionId") ?? ""), assetId: String(form.get("assetId") ?? ""),
        startsAt: String(form.get("startsAt") ?? ""), endsAt: String(form.get("endsAt") ?? "") };
      router.replace(labWorkspaceUrl(submitted, state.runId), { scroll: false });
    } else {
      setAttemptFailed(true);
    }
    return state;
  }, initial);
  const [syncState, syncAction, syncPending] = useActionState((previous: LabActionState, form: FormData) => invokeLabAction(syncCandleSource, previous, form), initial);
  const busy = runPending || syncPending;

  function edit(key: keyof LabFormValues, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    // Persist the draft without a server request on every keystroke. Controlled
    // inputs are not reset by React's successful form-action reset.
    window.history.replaceState(null, "", labWorkspaceUrl(next, selectedRunId));
  }
  function selectResult(runId: string | null) {
    setSelectedRunId(runId); setAttemptFailed(false);
    router.replace(labWorkspaceUrl(values, runId), { scroll: false });
  }
  const displayed = resolveLabResult(selectedRunId, requestedRunId, result, runPending, attemptFailed);
  const canRun = definitions.some(item => item.id === values.definitionId) && assets.some(item => item.id === values.assetId);
  const selectedDefinition = definitions.find(item => item.id === values.definitionId);
  const selectedAsset = assets.find(item => item.id === values.assetId);
  const selectedSource = sources.find(item => item.id === values.sourceId);
  const selectedRunLabel = runs.find(run => run.id === selectedRunId)?.label ?? (selectedRunId
    ? `${result.run?.id === selectedRunId ? `${result.run.symbol} · ${result.run.strategyName}` : "Vald körning"} · ${selectedRunId}`
    : "Välj ett sparat resultat");

  return <>
    <section className={panel.panel}>
      <header><div><p>BACKTEST WORKSPACE</p><h2>Test a strategy</h2></div><span>Välj regelversion, asset och historiskt fönster</span></header>
      <div className={styles.workspaceGrid}>
        <form action={runAction} className={styles.controlCard} aria-busy={runPending}>
          <div className={styles.cardHeader}><small>BACKTEST</small><h3>Run historical evaluation</h3><p>Testa en låst regelversion mot point-in-time marknadsdata. Datum och val behålls efter körningen.</p></div>
          <div className={styles.fieldGrid}>
            <div><label>Strategy<select name="definitionId" value={values.definitionId} aria-describedby={`${detailId}-strategy`} onChange={event => edit("definitionId", event.target.value)} disabled={busy} required>
              {!definitions.some(item => item.id === values.definitionId) && <option value={values.definitionId}>{values.definitionId ? "Vald strategi är inte tillgänglig" : "Välj strategi"}</option>}
              {definitions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.timeframe}</option>)}
            </select></label><p id={`${detailId}-strategy`} className={styles.selectionDetail}>{selectedDefinition ? `${selectedDefinition.name} · ${selectedDefinition.timeframe}` : values.definitionId ? "Vald strategi är inte tillgänglig" : "Välj strategi"}</p></div>
            <div><label>Asset<select name="assetId" value={values.assetId} aria-describedby={`${detailId}-asset`} onChange={event => edit("assetId", event.target.value)} disabled={busy} required>
              {!assets.some(item => item.id === values.assetId) && <option value={values.assetId}>{values.assetId ? "Vald asset är inte tillgänglig" : "Välj asset"}</option>}
              {assets.map(item => <option key={item.id} value={item.id}>{item.symbol} · {item.kind}</option>)}
            </select></label><p id={`${detailId}-asset`} className={styles.selectionDetail}>{selectedAsset ? `${selectedAsset.symbol} · ${selectedAsset.kind}` : values.assetId ? "Vald asset är inte tillgänglig" : "Välj asset"}</p></div>
          </div>
          <div className={styles.dateRow}>
            <label>From<input name="startsAt" type="date" value={values.startsAt} onChange={event => edit("startsAt", event.target.value)} disabled={busy} required/></label>
            <label>To<input name="endsAt" type="date" value={values.endsAt} onChange={event => edit("endsAt", event.target.value)} disabled={busy} required/></label>
          </div>
          {!assets.length && <p className={styles.actionWarning}>Ingen asset har en aktiv candle-källa. Kontrollera Historical Data nedan.</p>}
          <button className={styles.primaryAction} disabled={busy || !canRun}>{runPending ? "Kör backtest…" : "Run deterministic backtest"}</button>
          <ActionMessage state={runState}/>
          {attemptFailed && selectedRunId && <button className={styles.secondaryAction} type="button" onClick={() => selectResult(selectedRunId)}>Visa tidigare valt sparat resultat</button>}
        </form>
        <form action={syncAction} className={styles.controlCard} aria-busy={syncPending}>
          <div className={styles.cardHeader}><small>DATA IMPORT</small><h3>Sync historical candles</h3><p>Import och backtest är olika åtgärder. En import byter inte det valda resultatet.</p></div>
          <div><label>Configured source<select name="sourceId" value={values.sourceId} aria-describedby={`${detailId}-source`} onChange={event => edit("sourceId", event.target.value)} disabled={busy} required>
            {!sources.some(item => item.id === values.sourceId) && <option value={values.sourceId}>{values.sourceId ? "Vald källa är inte tillgänglig" : "Välj källa"}</option>}
            {sources.map(item => <option key={item.id} value={item.id}>{item.label} · {item.status}</option>)}
          </select></label><p id={`${detailId}-source`} className={styles.selectionDetail}>{selectedSource ? `${selectedSource.label} · ${selectedSource.status}` : values.sourceId ? "Vald källa är inte tillgänglig" : "Välj källa"}</p></div>
          <div className={styles.infoBox}><span>BOUNDED INGESTION</span><p>Max tre providersidor per körning. Importen sparar sin cursor och kan återupptas säkert.</p></div>
          <button className={styles.secondaryAction} disabled={busy || !sources.some(item => item.id === values.sourceId)}>{syncPending ? "Importerar…" : "Import next candle batch"}</button>
          <ActionMessage state={syncState}/>
        </form>
      </div>
    </section>
    <section className={panel.panel} id="lab-result" aria-busy={displayed.status === "running" || displayed.status === "loading"}>
      <header><div><p>SELECTED IMMUTABLE RESULT</p><h2>Resultat för vald körning</h2></div><span>Kapital och diagram nedan tillhör samma körnings-ID.</span></header>
      <div className={styles.resultPicker}>
        <label>Sparade körningar<select value={selectedRunId ?? ""} aria-describedby={`${detailId}-run`} onChange={event => selectResult(event.target.value || null)} disabled={busy}>
          <option value="">Välj ett sparat resultat</option>
          {selectedRunId && !runs.some(run => run.id === selectedRunId) && <option value={selectedRunId}>{selectedRunLabel}</option>}
          {runs.map(run => <option value={run.id} key={run.id}>{run.label}</option>)}
        </select></label>
        <p id={`${detailId}-run`} className={styles.selectionDetail}>{selectedRunLabel}{displayed.status === "unavailable" ? " · Resultatet är inte tillgängligt." : ""}</p>
        <p>Att ändra formuläret räknar inte om ett sparat resultat. Kör backtest för att testa de nya valen.</p>
      </div>
      <LabResultPanels result={displayed}/>
    </section>
  </>;
}
function ActionMessage({ state }: { state: LabActionState }) {
  const className = state.status === "ERROR" ? styles.actionError : state.status === "WARNING" ? styles.actionWarning : styles.actionSuccess;
  return state.message ? <output className={className} role={state.status === "ERROR" ? "alert" : "status"} aria-live="polite">{state.message}</output> : null;
}
