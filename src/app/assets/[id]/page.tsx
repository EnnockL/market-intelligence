import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreRing } from "@/components/score-ring";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, db = createServiceClient();
  const [{ data: asset }, { data: signal }] = await Promise.all([
    db.from("assets").select("id,symbol,name,kind").eq("id", id).maybeSingle(),
    db.from("signals").select("id,direction,opportunity_score,risk_score,confidence,scoring_version,thesis,observed_price_usd,generated_at,status").eq("asset_id", id).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!asset) notFound();
  const price = nullableNumber(signal?.observed_price_usd);
  return <main className="asset-page">
    <Link className="back-link" href="/">← Back to market radar</Link>
    <section className="asset-hero"><div><span className={`tag tag--${asset.kind}`}>{asset.kind}</span><span className="source-badge source-badge--live">DATABASE</span><h1>{asset.symbol}</h1><p>{asset.name} · {signal ? `Signal observed ${new Date(signal.generated_at).toLocaleString("sv-SE")}` : "No persisted signal"}</p></div><div className="asset-price"><strong>{price === null ? "UNKNOWN" : `$${price < 1 ? price.toFixed(5) : price.toFixed(2)}`}</strong><span className="neutral">24H CHANGE UNKNOWN</span></div></section>
    {signal ? <><section className="score-panel"><div><span className="eyebrow">OPPORTUNITY</span><ScoreRing score={Number(signal.opportunity_score)} /></div><div><span className="eyebrow">RISK</span><ScoreRing score={Number(signal.risk_score)} risk /></div><div><span className="eyebrow">CONFIDENCE</span><strong>{signal.confidence === null ? "UNKNOWN" : `${signal.confidence}%`}</strong><small>Persisted model confidence</small></div><div className="score-summary"><span className="eyebrow">THESIS</span><p>{signal.thesis ?? "No persisted thesis."}</p></div></section><section className="detail-grid"><article><span className="eyebrow">TRACEABILITY</span><h2>Signal record</h2><p><b>01</b>Model {signal.scoring_version}</p><p><b>02</b>Direction {signal.direction}</p><p><b>03</b>Status {signal.status}</p></article><article><span className="eyebrow">LIMITATIONS</span><h2>Unknown data</h2><p><b>01</b>24-hour change is not available in this signal record</p><p><b>02</b>No claim is made beyond persisted evidence</p></article></section></> : <section className="radar-panel dashboard-empty"><strong>No signal data for this asset</strong><span>The asset exists in Supabase, but no deterministic signal has been persisted.</span></section>}
    <div className="audit-note">This view reads persisted Supabase records. UNKNOWN means the required evidence is unavailable.</div>
  </main>;
}

function nullableNumber(value: unknown) { const number = Number(value); return value === null || value === undefined || !Number.isFinite(number) ? null : number; }
