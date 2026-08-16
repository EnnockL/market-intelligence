import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreRing } from "@/components/score-ring";
import { opportunities } from "@/data/mock-market";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = opportunities.find((item) => item.id === id);
  if (!asset) notFound();
  return (
    <main className="asset-page">
      <Link className="back-link" href="/">← Back to market radar</Link>
      <section className="asset-hero">
        <div><span className={`tag tag--${asset.kind}`}>{asset.kind}</span><h1>{asset.symbol}</h1><p>{asset.name} · Updated {asset.updatedAt}</p></div>
        <div className="asset-price"><strong>${asset.price < 1 ? asset.price.toFixed(5) : asset.price.toFixed(2)}</strong><span className={asset.change24h >= 0 ? "positive" : "negative"}>{asset.change24h >= 0 ? "+" : ""}{asset.change24h}% today</span></div>
      </section>
      <section className="score-panel">
        <div><span className="eyebrow">OPPORTUNITY</span><ScoreRing score={asset.opportunityScore} /></div>
        <div><span className="eyebrow">RISK</span><ScoreRing score={asset.riskScore} risk /></div>
        <div><span className="eyebrow">CONFIDENCE</span><strong>{asset.confidence}%</strong><small>Data-backed confidence</small></div>
        <div className="score-summary"><span className="eyebrow">WHAT CHANGED?</span><p>{asset.summary}</p></div>
      </section>
      <section className="detail-grid">
        <article><span className="eyebrow">POSITIVE EVIDENCE</span><h2>Bull case</h2>{asset.factors.map((factor, i) => <p key={factor}><b>0{i + 1}</b>{factor}</p>)}</article>
        <article><span className="eyebrow">RISK CONTROL</span><h2>Bear case</h2><p><b>01</b>{asset.negativeFactors} material negative factors detected</p><p><b>02</b>Signal may decay before the catalyst window</p><p><b>03</b>Position size must reflect the {asset.riskScore}/100 risk score</p></article>
      </section>
      <div className="audit-note">This view uses demonstration data. Scores are deterministic and must be persisted with their input components and scoring version.</div>
    </main>
  );
}

