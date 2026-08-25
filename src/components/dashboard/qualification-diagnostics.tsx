import Link from "next/link";
import type { getQualificationData } from "@/data/qualification-data";
import s from "./qualification-diagnostics.module.css";
export function QualificationDiagnostics({
  data,
}: {
  data: Awaited<ReturnType<typeof getQualificationData>>;
}) {
  const stages = [
    "DISCOVERED",
    "WATCHING",
    "ACCELERATING",
    "JACKPOT_CANDIDATE",
    "QUALIFIED",
  ];
  return (
    <section className={s.panel}>
      <header className={s.head}>
        <div>
          <span className="eyebrow">DECISION TRANSPARENCY</span>
          <h2>Qualification Diagnostics</h2>
          <p>Why candidates advance, wait, or fail — without hidden scores.</p>
        </div>
        <span className={s.policy}>{data.policyVersion}</span>
      </header>
      <div className={s.funnel}>
        {stages.map((stage) => (
          <div className={s.stage} key={stage}>
            <span>{stage.replaceAll("_", " ")}</span>
            <strong>{Number((data.funnel as any)[stage] ?? 0)}</strong>
          </div>
        ))}
      </div>
      <div className={s.body}>
        <div className={s.list}>
          {data.candidates.length ? (
            data.candidates.map((c) => (
              <Link
                className={s.row}
                href={`/jackpot/${c.id}`}
                key={c.evaluationId}
              >
                <strong className={s.symbol}>{c.symbol}</strong>
                <span
                  className={`${s.decision} ${s[c.decision.toLowerCase() as "qualified" | "watch" | "rejected"]}`}
                >
                  {c.decision}
                </span>
                <small className={s.reason}>
                  {c.reason.replaceAll("_", " ")}
                </small>
                <span className={s.counts}>
                  <span>
                    <b>{c.failed}</b> failed
                  </span>
                  <span>
                    <b>{c.unknown}</b> unknown
                  </span>
                </span>
                <b className={s.arrow}>›</b>
              </Link>
            ))
          ) : (
            <div className={s.empty}>
              Run the qualification worker to create the first immutable
              diagnostics.
            </div>
          )}
        </div>
        <aside className={s.stats}>
          <h3>Top blockers</h3>
          <Distribution
            values={data.blockerFrequency as Record<string, number>}
          />
          <h3>Unknown coverage gaps</h3>
          <Distribution
            values={data.unknownFrequency as Record<string, number>}
            unknown
          />
        </aside>
      </div>
    </section>
  );
}
function Distribution({
  values,
  unknown = false,
}: {
  values: Record<string, number>;
  unknown?: boolean;
}) {
  const entries = Object.entries(values)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    max = Math.max(1, ...entries.map((x) => x[1]));
  return entries.length ? (
    <>
      {entries.map(([key, value]) => (
        <div className={`${s.bar} ${unknown ? s.unknown : ""}`} key={key}>
          <div>
            <span>{key.replaceAll("_", " ")}</span>
            <b>{value}</b>
          </div>
          <i style={{ width: `${(value / max) * 100}%` }} />
        </div>
      ))}
    </>
  ) : (
    <p className={s.meta}>No records yet</p>
  );
}
