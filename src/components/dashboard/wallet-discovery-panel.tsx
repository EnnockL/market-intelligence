import type { DashboardWalletDiscoveryData } from "@/data/wallet-discovery-data";
import { DataStatus } from "./data-status";

export function WalletDiscoveryPanel({ data }: { data: DashboardWalletDiscoveryData }) {
  return <section className="radar-panel discovery-panel">
    <div className="panel-title discovery-title"><div><span className="eyebrow">ON-CHAIN DISCOVERY</span><h2>Wallet Candidates</h2></div><DataStatus mode={data.mode} updatedAt={data.updatedAt} message={data.message} /></div>
    {data.candidates.length ? <div className="discovery-list">{data.candidates.map((item, index) => {
      const successRate = item.observedTransactions ? Math.round(item.successfulTransactions / item.observedTransactions * 100) : 0;
      return <article key={item.address}>
        <span className="discovery-rank">#{index + 1}</span>
        <div className="discovery-wallet"><strong>{shortAddress(item.address)}</strong><span title={item.address}>{item.address}</span></div>
        <Metric value={`${item.score}/75`} label="discovery" />
        <Metric value={`${item.dataQuality}%`} label="data quality" />
        <Metric value={`${successRate}%`} label="successful" />
        <Metric value={formatDays(item.activeDays)} label="activity span" />
        <div className="discovery-flags">{item.riskFlags.slice(0, 2).map((flag) => <i className={flag === "profitability_unverified" ? "risk-pill risk-pill--high" : "risk-pill risk-pill--extreme"} key={flag}>{readable(flag)}</i>)}</div>
        <span className={`candidate-status candidate-status--${item.status}`}>{item.status}</span>
      </article>;
    })}</div> : <div className="discovery-empty"><strong>No wallet candidates to display</strong><span>{data.message}</span></div>}
    <div className="discovery-note">Discovery scores rank observable activity only. Profitability remains unverified until historical prices, fees and slippage are available.</div>
  </section>;
}

function Metric({ value, label }: { value: string; label: string }) { return <div className="discovery-metric"><strong>{value}</strong><span>{label}</span></div>; }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-5)}`; }
function formatDays(value: number) { return value < 0.1 ? "< 0.1d" : `${value.toFixed(1)}d`; }
function readable(value: string) { return value.replaceAll("_", " "); }
