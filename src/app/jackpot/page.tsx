import { JackpotRadar } from "@/components/dashboard/jackpot-radar";
import { getJackpotData } from "@/data/jackpot-data";
import styles from "../workspace-pages.module.css";
export const dynamic = "force-dynamic";
export default async function JackpotPage(){const data=await getJackpotData();return <main className={styles.page}><section className={styles.hero}><small>ASYMMETRIC RESEARCH</small><h1>Jackpot Radar</h1><p>Early candidates and their immutable evidence timelines. UNKNOWN remains unknown when coverage is insufficient.</p></section><JackpotRadar data={data}/></main>}
