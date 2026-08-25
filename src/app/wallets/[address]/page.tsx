import Link from "next/link";
import { notFound } from "next/navigation";
import { DataStatus } from "@/components/dashboard/data-status";
import { getWalletDetailData } from "@/data/wallet-detail-data";

export const dynamic = "force-dynamic";
export default async function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params; const data = await getWalletDetailData(address);
  if (!data.found && data.mode === "live") notFound();
  const metric = data.metric;
  return <main className="wallet-page">
    <Link href="/" className="back-link">← Market radar</Link>
    <section className="wallet-hero"><div><span className="eyebrow">WALLET INTELLIGENCE</span><h1>{shortAddress(address)}</h1><p>{address}</p><DataStatus mode={data.mode} updatedAt={data.discovery?.lastObservedAt ?? metric?.calculatedAt ?? null} message={data.message} /></div><div className="wallet-badges"><span className={`candidate-status candidate-status--${data.discovery?.status ?? "candidate"}`}>{data.discovery?.status ?? (data.tracked ? "tracked" : "unknown")}</span><span className="tag">READ ONLY</span></div></section>
    <section className="wallet-kpis"><Kpi label="Status" value={(data.verification?.eligibleStatus ?? "candidate").toUpperCase()} /><Kpi label="Score V3" value={data.scoreV3 ? `${data.scoreV3.score}/100` : "—"} /><Kpi label="Verified trades" value={String(metric?.verifiedTrades ?? 0)} /><Kpi label="Historical pricing" value={metric ? `${metric.pricingCoverage}%` : "—"} /><Kpi label="Historical liquidity" value={metric ? `${metric.liquidityCoverage}%` : "—"} /><Kpi label="Risk coverage" value={metric ? `${metric.riskDataQuality}%` : "—"} /><Kpi label="Max drawdown" value={percent(metric?.maxDrawdown, true)} /><Kpi label="Rug exposure" value={percent(metric?.rugExposureRate, true)} /></section>
    {!metric?.verifiedTrades && <section className="verification-banner"><strong>Performance not verified yet</strong><p>Historical token and SOL prices are missing for one or more executions. P/L, win rate and returns remain blank instead of using current prices.</p></section>}
    {data.verification?.failed.length ? <section className="verification-banner"><strong>Verification blockers ({data.verification.failed.length})</strong>{data.verification.failed.map((blocker) => <p key={blocker}>— {blocker}</p>)}</section> : null}
    {data.progress.length ? <section className="radar-panel"><Title kicker="VERIFICATION PROGRESS" title="Path to verified" /><div className="wallet-kpis">{data.progress.map((item) => <Kpi key={item.key} label={item.key.replaceAll("_", " ")} value={`${formatProgressValue(item.value)}/${formatProgressValue(item.required)}${item.passed ? " PASS" : ` · ${item.remaining} remaining`}`} />)}</div></section> : null}
    <section className="wallet-detail-grid"><article className="radar-panel"><Title kicker="POSITION ENGINE" title="Trade cycles" /><div className="wallet-table">{data.cycles.length ? data.cycles.map((cycle) => <div key={cycle.id}><div><strong>{cycle.symbol}</strong><span>{formatDate(cycle.firstEntryAt)} → {cycle.finalExitAt ? formatDate(cycle.finalExitAt) : "OPEN"}</span></div><span className={`cycle-state cycle-state--${cycle.status}`}>{cycle.status}</span><Metric label="Quantity" value={formatNumber(cycle.quantity)} /><Metric label="P/L" value={money(cycle.realizedPnlUsd)} /><Metric label="Return" value={percent(cycle.returnPercent)} /><Metric label="Quality" value={`${cycle.dataQuality}%`} /></div>) : <Empty text="No reconstructed trade cycles yet" />}</div></article>
      <article className="radar-panel"><Title kicker="AUDIT TRAIL" title="Recent transactions" /><div className="wallet-table transaction-table">{data.transactions.length ? data.transactions.map((tx) => <div key={tx.id}><div><strong>{tx.symbol}</strong><span>{shortAddress(tx.signature)} · {formatDate(tx.occurredAt)}</span></div><span className={`direction direction--${tx.side === "buy" ? "bullish" : tx.side === "sell" ? "bearish" : "neutral"}`}>{tx.side}</span><Metric label="Quantity" value={tx.quantity === null ? "—" : formatNumber(tx.quantity)} /><Metric label="Value" value={money(tx.estimatedValueUsd)} /><span className={`enrichment-state enrichment-state--${tx.enrichmentStatus}`}>{tx.enrichmentStatus}</span></div>) : <Empty text="No normalized transactions for this wallet" />}</div></article></section>
    <section className="wallet-risk radar-panel"><Title kicker="EVIDENCE" title="Discovery assessment" /><div className="risk-grid"><div><h3>Reasons</h3>{data.discovery?.reasons.map((reason) => <p key={reason}>+ {reason}</p>) ?? <p>No discovery evidence</p>}</div><div><h3>Risk flags</h3>{data.discovery?.riskFlags.map((flag) => <p key={flag}>! {flag.replaceAll("_", " ")}</p>) ?? <p>No risk flags</p>}</div></div></section>
  </main>;
}

function Kpi({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="row-metric"><span>{label}</span><strong>{value}</strong></div>; }
function Title({ kicker, title }: { kicker: string; title: string }) { return <div className="panel-title"><div><span className="eyebrow">{kicker}</span><h2>{title}</h2></div></div>; }
function Empty({ text }: { text: string }) { return <div className="wallet-empty">{text}</div>; }
function shortAddress(value: string) { return value.length > 15 ? `${value.slice(0, 7)}…${value.slice(-6)}` : value; }
function money(value: number | null | undefined) { return value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function percent(value: number | null | undefined, fraction = false) { return value === null || value === undefined ? "—" : `${(fraction ? value * 100 : value).toFixed(1)}%`; }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date(value)); }
function formatProgressValue(value: number | boolean) { return typeof value === "boolean" ? (value ? "YES" : "NO") : String(value); }
