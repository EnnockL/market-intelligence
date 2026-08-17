import { DataStatus } from "./data-status";
import type { DashboardOpportunityData } from "@/data/opportunity-data";

export function FastFlowPanel({ data }: { data: DashboardOpportunityData }) {
  return <section className="radar-panel fast-flow-panel"><div className="panel-title fast-flow-title"><div><span className="eyebrow">REAL-TIME CONVERGENCE</span><h2>Fast Flow <i>⚡</i></h2></div><DataStatus mode={data.mode} updatedAt={data.updatedAt} message={data.message} /></div>
    {data.items.length ? <div className="fast-flow-list">{data.items.map((item) => <article key={item.id}><div className="fast-flow-asset"><strong>{item.symbol}</strong><span>{item.name}</span></div><Metric value={String(item.walletCount)} label="verified wallets" /><Metric value={String(item.score)} label="opportunity" /><Metric value={item.riskScore === null ? "UNKNOWN" : String(item.riskScore)} label="risk" /><Metric value={`${item.dataQuality}%`} label="data quality" /><div className="fast-flow-blockers">{item.blockers.length ? item.blockers.slice(0, 2).map((blocker) => <span key={blocker}>{blocker.replaceAll("_", " ")}</span>) : <span className="fast-flow-pass">SAFETY PASS</span>}</div><b className={`flow-state flow-state--${item.state}`}>{item.state.replaceAll("_", " ")}</b></article>)}</div> : <div className="discovery-empty"><strong>No qualified convergence yet</strong><span>{data.message}. The 3-wallet and 80% verification requirements remain unchanged.</span></div>}
  </section>;
}
function Metric({ value, label }: { value: string; label: string }) { return <div className="discovery-metric"><strong>{value}</strong><span>{label}</span></div>; }
