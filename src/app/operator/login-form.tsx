"use client";

import { useActionState } from "react";
import { loginOperator, type OperatorLoginState } from "./actions";
import styles from "./operator.module.css";

const initialState: OperatorLoginState = { status: "IDLE", message: "" };

export function OperatorLoginForm({ nextPath, configured }: { nextPath: string; configured: boolean }) {
  const [state, action, pending] = useActionState(loginOperator, initialState);
  return <form action={action} className={styles.form}>
    <input name="next" type="hidden" value={nextPath} />
    <label htmlFor="operator-token">Operatörstoken</label>
    <input id="operator-token" name="operatorToken" type="password" autoComplete="current-password" required maxLength={4096} disabled={!configured || pending} />
    <button type="submit" disabled={!configured || pending}>{pending ? "Loggar in…" : "Logga in"}</button>
    <p role="status" aria-live="polite">{state.message}</p>
  </form>;
}
