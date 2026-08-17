import Link from "next/link";
import type { getPaperPortfolioData } from "@/data/paper-portfolio-data";
export function PaperPortfolioPanel({
  data,
}: {
  data: Awaited<ReturnType<typeof getPaperPortfolioData>>;
}) {
  return (
    <section className="radar-panel paper-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">DETERMINISTIC RESEARCH</span>
          <h2>Paper Portfolios</h2>
          <p>Same candidate stream, isolated policies, no real execution.</p>
        </div>
        <Link href="/paper" className="paper-view">
          Open lab →
        </Link>
      </div>
      {data.portfolios.length ? (
        <div className="paper-summary">
          {data.portfolios.map((p) => (
            <Link href={`/paper#${p.id}`} key={p.id}>
              <span>{p.policy?.replaceAll("_", " ")}</span>
              <strong>{money(p.equity)}</strong>
              <small className={p.returnPct >= 0 ? "positive" : "negative"}>
                {p.returnPct >= 0 ? "+" : ""}
                {p.returnPct.toFixed(2)}%
              </small>
              <i>
                {p.openPositions} open · {money(p.cash)} cash
              </i>
            </Link>
          ))}
        </div>
      ) : (
        <div className="discovery-empty">
          <strong>No paper portfolios initialized</strong>
          <span>
            Run the paper eligibility worker to create the four research
            policies.
          </span>
        </div>
      )}
    </section>
  );
}
function money(v: number) {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(v);
}
