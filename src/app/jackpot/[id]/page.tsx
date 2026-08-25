import Link from "next/link";
import { notFound } from "next/navigation";
import { getJackpotDetail } from "@/data/jackpot-detail-data";
import s from "./qualification.module.css";

export const dynamic = "force-dynamic";

export default async function JackpotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getJackpotDetail(id);
  if (!result.data && !result.error) notFound();
  if (!result.data)
    return (
      <main className="jackpot-detail">
        <Link href="/" className="back-link">
          ← Market Radar
        </Link>
        <div className="verification-banner">
          <strong>DETAILS UNAVAILABLE</strong>
          <p>{result.error}</p>
        </div>
      </main>
    );
  const item = result.data,
    latest = item.revisions.at(-1),
    features = latest?.features ?? {};
  return (
    <main className="jackpot-detail">
      <Link href="/" className="back-link">
        ← Jackpot Radar
      </Link>
      <header className="wallet-hero">
        <div>
          <span className="eyebrow">JACKPOT CANDIDATE</span>
          <h1>{item.symbol}</h1>
          <p>{item.name ?? item.id}</p>
        </div>
        <span
          className={`jackpot-state jackpot-state--${item.state.toLowerCase()}`}
        >
          {item.state.replaceAll("_", " ")}
        </span>
      </header>
      <section className="wallet-kpis jackpot-kpis">
        <article>
          <span>Detected</span>
          <strong>{format(item.detectedAt)}</strong>
        </article>
        <article>
          <span>Revision</span>
          <strong>v{item.revision}</strong>
        </article>
        <article>
          <span>Raw wallets</span>
          <strong>{value(features.rawWalletCount)}</strong>
        </article>
        <article>
          <span>Independent</span>
          <strong>{value(features.confirmedIndependent)}</strong>
        </article>
        <article>
          <span>Coverage</span>
          <strong>
            {features.relationshipCoverage == null
              ? "Unknown"
              : `${features.relationshipCoverage}%`}
          </strong>
        </article>
        <article>
          <span>Safety</span>
          <strong>{String(latest?.safety?.status ?? "UNKNOWN")}</strong>
        </article>
      </section>
      <div className="jackpot-detail-grid">
        <section className="radar-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">IMMUTABLE HISTORY</span>
              <h2>Candidate timeline</h2>
            </div>
          </div>
          <div className="jackpot-timeline">
            {item.revisions.map((r) => (
              <article key={r.number}>
                <b>v{r.number}</b>
                <div>
                  <strong>{r.type.replaceAll("_", " ")}</strong>
                  <span>{r.state.replaceAll("_", " ")}</span>
                </div>
                <time>{format(r.cutoff)}</time>
                <small>{r.evidence.length} evidence refs</small>
              </article>
            ))}
          </div>
        </section>
        <section className="radar-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">LATEST REVISION</span>
              <h2>Evidence & diagnostics</h2>
            </div>
          </div>
          <dl className="jackpot-facts">
            <div>
              <dt>Collector</dt>
              <dd>{item.collectorVersion}</dd>
            </div>
            <div>
              <dt>Source event</dt>
              <dd>{item.sourceEventId}</dd>
            </div>
            <div>
              <dt>Trigger event</dt>
              <dd>{latest?.triggerEventId ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Information cutoff</dt>
              <dd>{latest ? format(latest.cutoff) : "Unknown"}</dd>
            </div>
            <div>
              <dt>Evidence references</dt>
              <dd>{latest?.evidence.length ?? 0}</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>Disabled</dd>
            </div>
          </dl>
        </section>
      </div>
      {item.qualification && <section className={`radar-panel ${s.section}`}>
        <div className="panel-title"><div><span className="eyebrow">QUALIFICATION DIAGNOSTICS</span><h2>Requirement evidence</h2><p>Revision {item.qualification.revision} · {item.qualification.policyVersion}</p></div></div>
        <div className={s.summary}><span className={s.decision}>{item.qualification.decision}</span><strong>{item.qualification.reason.replaceAll("_"," ")}</strong><small>Cutoff {format(item.qualification.cutoff)}</small></div>
        <div className={s.grid}>{item.qualification.requirements.map(r=><article className={s.row} key={r.key}><header><h3>{r.key.replaceAll("_"," ")}</h3><b className={s[r.status.toLowerCase() as "pass"|"fail"|"unknown"|"not_applicable"]}>{r.status.replaceAll("_"," ")}</b></header><dl><dt>Observed</dt><dd>{display(r.observed)}</dd><dt>Required</dt><dd>{display(r.required)}</dd><dt>Blocker</dt><dd>{r.blocker ?? "None"}</dd><dt>Source</dt><dd>{r.source ?? "Unknown"}</dd><dt>Data quality</dt><dd>{r.quality == null ? "Unknown" : `${r.quality}%`}</dd></dl><div className={s.refs}>{r.evidence.length ? r.evidence.map((e:any)=>e.id).join(" · ") : "No evidence reference"}</div></article>)}</div>
      </section>}
      {item.outcome && (
        <section className="radar-panel jackpot-outcome">
          <div className="panel-title">
            <div>
              <span className="eyebrow">RESEARCH OUTCOME</span>
              <h2>Observed performance</h2>
            </div>
          </div>
          <div>
            <article>
              <span>Max multiple</span>
              <strong>
                {item.outcome.maxMultiple == null
                  ? "Unknown"
                  : `${item.outcome.maxMultiple.toFixed(2)}×`}
              </strong>
            </article>
            <article>
              <span>MFE</span>
              <strong>{value(item.outcome.mfe)}</strong>
            </article>
            <article>
              <span>MAE</span>
              <strong>{value(item.outcome.mae)}</strong>
            </article>
            <article>
              <span>Data quality</span>
              <strong>{item.outcome.quality}%</strong>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
function value(v: unknown) {
  return v == null ? "Unknown" : String(v);
}
function format(v: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(v));
}
function display(v: unknown){return v === null || v === undefined ? "Unknown" : typeof v === "object" ? JSON.stringify(v) : String(v)}
