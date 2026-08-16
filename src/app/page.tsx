import { OpportunityCard } from "@/components/opportunity-card";
import { RecentSignalsPanel, SmartMoneyPanel, StockRadarPanel, WatchlistPanel } from "@/components/dashboard/intelligence-panels";
import { DataStatus } from "@/components/dashboard/data-status";
import { getDashboardStockData } from "@/data/dashboard-data";
import { marketPulse, opportunities, recentSignals, smartMoneyClusters, watchlist } from "@/data/mock-market";

export default async function Dashboard() {
  const stockData = await getDashboardStockData();
  return <main>
    <section className="hero"><div><span className="eyebrow">MARKET INTELLIGENCE</span><h1>Market <em>radar</em></h1><p>Deterministic signals, ranked by opportunity. Every score is traceable to its evidence.</p><DataStatus mode={stockData.mode} updatedAt={stockData.updatedAt} message={stockData.message} /></div><div className="last-scan"><span>INGESTION STATUS</span><strong>{stockData.mode.toUpperCase()}</strong><small>{stockData.message}</small></div></section>
    <section className="pulse-grid">{marketPulse.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small className={item.tone}>{item.change}</small></article>)}</section>
    <section className="content-grid"><div><div className="section-heading"><div><span className="eyebrow">RANKED NOW</span><h2>Top Opportunities</h2></div><button>All assets <span>→</span></button></div><div className="opportunities">{opportunities.map((item, index) => <OpportunityCard key={item.id} opportunity={item} rank={index + 1} />)}</div></div><aside><RecentSignalsPanel signals={recentSignals} /><div className="coverage"><span>COVERAGE</span><div><strong>100</strong><small>Wallets</small></div><div><strong>100</strong><small>Stocks</small></div><div><strong>2,218</strong><small>Tokens</small></div></div></aside></section>
    <section className="intelligence-grid"><SmartMoneyPanel clusters={smartMoneyClusters} /><StockRadarPanel stocks={stockData.stocks} /></section>
    <WatchlistPanel assets={watchlist} />
    <footer>Market Intelligence Engine <span>V0.3 · {stockData.mode.toUpperCase()} · PAPER ONLY · NOT FINANCIAL ADVICE</span></footer>
  </main>;
}
