import { OpportunityCard } from "@/components/opportunity-card";
import { RecentSignalsPanel, SmartMoneyPanel, StockRadarPanel, WatchlistPanel } from "@/components/dashboard/intelligence-panels";
import { marketPulse, opportunities, recentSignals, smartMoneyClusters, stockRadar, watchlist } from "@/data/mock-market";

export default function Dashboard() {
  return <main>
    <section className="hero"><div><span className="eyebrow">DEMO INTELLIGENCE · 16 AUG 2026</span><h1>Market <em>radar</em></h1><p>Deterministic signals, ranked by opportunity. Every score is traceable to its evidence.</p></div><div className="last-scan"><span>LAST MOCK SCAN</span><strong>18:42:08</strong><small>2,418 assets · 100 wallets</small></div></section>
    <section className="pulse-grid">{marketPulse.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small className={item.tone}>{item.change}</small></article>)}</section>
    <section className="content-grid"><div><div className="section-heading"><div><span className="eyebrow">RANKED NOW</span><h2>Top Opportunities</h2></div><button>All assets <span>→</span></button></div><div className="opportunities">{opportunities.map((item, index) => <OpportunityCard key={item.id} opportunity={item} rank={index + 1} />)}</div></div><aside><RecentSignalsPanel signals={recentSignals} /><div className="coverage"><span>COVERAGE</span><div><strong>100</strong><small>Wallets</small></div><div><strong>100</strong><small>Stocks</small></div><div><strong>2,218</strong><small>Tokens</small></div></div></aside></section>
    <section className="intelligence-grid"><SmartMoneyPanel clusters={smartMoneyClusters} /><StockRadarPanel stocks={stockRadar} /></section>
    <WatchlistPanel assets={watchlist} />
    <footer>Market Intelligence Engine <span>V0.2 · MOCK DATA · PAPER ONLY · NOT FINANCIAL ADVICE</span></footer>
  </main>;
}
