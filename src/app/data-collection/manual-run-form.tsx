"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { queueIngestionJob, type QueueState } from "./actions";
import styles from "./data-collection.module.css";

const initialState: QueueState = { status: "idle", message: "" };

export function ManualRunForm({ jobs, enabled }: { jobs: Array<{ job_key: string; job_type: string }>; enabled: boolean }) {
  const [state, action] = useActionState(queueIngestionJob, initialState);
  return <form action={action} className={styles.manualForm}>
    <label>Safe ingestion job<select name="jobKey" disabled={!enabled}>{jobs.map((job) => <option value={job.job_key} key={job.job_key}>{job.job_key}</option>)}</select></label>
    <p><Link href="/operator?next=%2Fdata-collection">Operator sign-in</Link> is required before queueing a job.</p>
    <SubmitButton disabled={!enabled || jobs.length === 0}/>
    <p className={state.status === "error" ? styles.actionError : styles.actionSuccess} aria-live="polite">{state.message || "Queues ingestion only. It cannot call execution jobs."}</p>
  </form>;
}

function SubmitButton({ disabled }: { disabled: boolean }) { const { pending } = useFormStatus(); return <button type="submit" disabled={disabled || pending}>{pending ? "Queueing…" : "Queue now"}</button>; }
