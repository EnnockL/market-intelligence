"use client";

import { useActionState } from "react";
import { registerHypothesis, runValidation, type ValidationActionState } from "./actions";
import styles from "./strategy-validation.module.css";

const initial: ValidationActionState = { status: "IDLE", message: "" };
type Definition = { id: string; name: string; strategy_key: string; version: number };
type Hypothesis = { id: string; strategy_definition_id: string; hypothesis_version: number; thesis: string };
type Run = { id: string; strategy_definition_id: string; label: string };

export function ValidationControls({ definitions, hypotheses, runs }: { definitions: Definition[]; hypotheses: Hypothesis[]; runs: Run[] }) {
  const [hypothesisState, hypothesisAction, hypothesisPending] = useActionState(registerHypothesis, initial);
  const [validationState, validationAction, validationPending] = useActionState(runValidation, initial);
  return <section className={styles.controlGrid}>
    <form action={hypothesisAction} className={styles.panel}>
      <header><div><p>01 · FREEZE THE IDEA</p><h2>Register hypothesis</h2></div></header>
      <label>Strategy<select name="strategyDefinitionId" required>{definitions.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
      <label>Hypothesis version<input name="hypothesisVersion" type="number" min="1" defaultValue="1" required/></label>
      <label>Thesis<textarea name="thesis" placeholder="Why should this setup have edge?" required/></label>
      <label>Expected mechanism<textarea name="expectedMechanism" placeholder="What market behavior should create the edge?" required/></label>
      <label>Invalidation condition<textarea name="invalidationCondition" placeholder="What observable fact proves the thesis wrong?" required/></label>
      <button disabled={hypothesisPending || !definitions.length}>{hypothesisPending ? "Freezing…" : "Freeze immutable hypothesis"}</button>
      <ActionMessage state={hypothesisState}/>
    </form>
    <form action={validationAction} className={styles.panel}>
      <header><div><p>02 · TEST THE EVIDENCE</p><h2>Run validation</h2></div></header>
      <label>Historical evaluations <small>Välj flera körningar för samma strategi med Ctrl/Cmd. Flera assets krävs för koncentrationsgrinden.</small><select name="evaluationRunIds" multiple size={7} required>{runs.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Frozen hypothesis<select name="hypothesisId" required>{hypotheses.map(item => <option key={item.id} value={item.id}>{item.thesis.slice(0, 72)} · v{item.hypothesis_version}</option>)}</select></label>
      <label>Validation phase<select name="phase" defaultValue="LEARNING"><option>LEARNING</option><option>FROZEN</option><option>OUT_OF_SAMPLE</option><option>DEMO_VALIDATION</option></select></label>
      <div className={styles.fieldGrid}><label>Modeled live cost (R)<input name="modeledLiveCostR" type="number" min="0" max="5" step="0.01" defaultValue="0.05"/></label><label>Stress cost (R)<input name="stressCostR" type="number" min="0" max="10" step="0.01" defaultValue="0.10"/></label></div>
      <div className={styles.notice}>Fasordningen verkställs. OOS-data måste ligga efter att hypotesen frysts. Ett resultat skapar alltid en säker runtime-bedömning med <b>NO_TRADE</b> tills alla runtime-grindar har riktig evidens.</div>
      <button disabled={validationPending || !hypotheses.length || !runs.length}>{validationPending ? "Validating…" : "Run deterministic validation"}</button>
      {!hypotheses.length ? <output className={styles.actionError}>Registrera först en hypotes till vänster.</output> : null}
      <ActionMessage state={validationState}/>
    </form>
  </section>;
}
function ActionMessage({ state }: { state: ValidationActionState }) { return state.message ? <output className={state.status === "ERROR" ? styles.actionError : styles.actionSuccess}>{state.message}</output> : null; }
