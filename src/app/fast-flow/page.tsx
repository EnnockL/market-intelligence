import { FastFlowPanel } from "@/components/dashboard/fast-flow-panel";
import { getFastFlowData } from "@/data/fast-flow-data";
import styles from "../workspace-pages.module.css";
export const dynamic = "force-dynamic";
export default async function FastFlowPage(){const data=await getFastFlowData();return <main className={styles.page}><section className={styles.hero}><small>REAL-TIME EVIDENCE</small><h1>Fast Flow</h1><p>Wallet convergence, independence coverage and hard safety evidence. This is observation infrastructure, never automatic execution.</p></section><FastFlowPanel data={data}/></main>}
