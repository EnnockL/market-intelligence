import Link from "next/link";
import { getPaperPortfolioData } from "@/data/paper-portfolio-data";
export const dynamic = "force-dynamic";
export default async function PaperPage() {
  const data = await getPaperPortfolioData();
  return (
    <main className="paper-page">
      <Link href="/" className="back-link">
        ← Market Radar
      </Link>
      <header className="wallet-hero">
        <div>
          <span className="eyebrow">RESEARCH ENGINE</span>
          <h1>Paper Portfolio</h1>
          <p>
            Deterministic policies with fees, delay, slippage and liquidity
            constraints.
          </p>
        </div>
      </header>
      {data.portfolios.map((p) => (
        <section className="radar-panel paper-portfolio" id={p.id} key={p.id}>
          <div className="panel-title">
            <div>
              <span className="eyebrow">{p.policy}</span>
              <h2>{p.name}</h2>
            </div>
            <strong>
              {p.returnPct >= 0 ? "+" : ""}
              {p.returnPct.toFixed(2)}%
            </strong>
          </div>
          <div className="paper-kpis">
            <article>
              <span>Initial</span>
              <strong>{money(p.initial)}</strong>
            </article>
            <article>
              <span>Equity</span>
              <strong>{money(p.equity)}</strong>
            </article>
            <article>
              <span>Cash</span>
              <strong>{money(p.cash)}</strong>
            </article>
            <article>
              <span>Open</span>
              <strong>{p.openPositions}</strong>
            </article>
            <article>
              <span>Realized PnL</span>
              <strong>{money(p.realizedPnl)}</strong>
            </article>
            <article>
              <span>Unrealized PnL</span>
              <strong>{money(p.unrealizedPnl)}</strong>
            </article>
          </div>
          <div className="paper-orders">
            {p.orders.length ? (
              p.orders.map((o: any) => (
                <Link href={`/paper/trades/${o.id}`} key={o.id}>
                  <strong>{o.symbol}</strong>
                  <span>{o.status.replaceAll("_", " ")}</span>
                  <span>{money(o.requested)} requested</span>
                  <span>
                    {o.executed
                      ? `${money(o.executed)} executed`
                      : (o.reason ?? "Pending")}
                  </span>
                  <b>Details →</b>
                </Link>
              ))
            ) : (
              <div className="discovery-empty">
                <span>No candidate evaluations have produced orders yet.</span>
              </div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
function money(v: number) {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2,
  }).format(v);
}
