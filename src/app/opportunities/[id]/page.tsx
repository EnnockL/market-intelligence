import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpportunityDetail } from "@/data/opportunity-detail-data";

export const dynamic = "force-dynamic";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const result = await getOpportunityDetail(id);
  if (!result.data && !result.error) notFound();
  if (!result.data) return <main className="opportunity-debug"><Link href="/" className="back-link">← Market Radar</Link><section className="verification-banner"><strong>OPPORTUNITY DIAGNOSTICS UNAVAILABLE</strong><p>{result.error}</p></section></main>;
  const opportunity = result.data;
  return <main className="opportunity-debug"><Link href="/" className="back-link">← Market Radar</Link>
    <header className="wallet-hero"><div><span className="eyebrow">DECISION INFRASTRUCTURE</span><h1>Opportunity {opportunity.id.slice(0, 8)}</h1><p>{opportunity.id}</p></div><div className="wallet-badges"><span className={`flow-state flow-state--${opportunity.state}`}>{opportunity.state.replaceAll("_", " ")}</span></div></header>
    <section className="wallet-kpis opportunity-debug-kpis"><article><span>State</span><strong>{opportunity.state}</strong></article><article><span>Revision</span><strong>{opportunity.currentRevision}</strong></article><article><span>Type</span><strong>{opportunity.opportunityType}</strong></article><article><span>Evidence</span><strong>{opportunity.timeline.reduce((sum, item) => sum + item.evidenceCount, 0)}</strong></article></section>
    <section className="radar-panel"><div className="panel-title"><div><span className="eyebrow">IMMUTABLE HISTORY</span><h2>Revision timeline</h2></div></div><div className="opportunity-timeline">
      <article><b>source</b><strong>{opportunity.sourceEventId}</strong><span>{formatTime(opportunity.detectedAt)}</span><small>Created from event</small></article>
      {opportunity.timeline.map((item) => <article key={item.revision}><b>v{item.revision}</b><strong>{item.state}</strong><span>{formatTime(item.informationCutoffAt)}</span><small>{item.revisionType} · {item.evidenceCount} evidence refs · trigger {item.triggerEventId}</small></article>)}
    </div></section>
  </main>;
}
function formatTime(value: string) { return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(value)); }
