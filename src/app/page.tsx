import { OpportunityCard } from "@/components/opportunity-card";
import { RecentSignalsPanel, StockRadarPanel } from "@/components/dashboard/intelligence-panels";
import { WalletDiscoveryPanel } from "@/components/dashboard/wallet-discovery-panel";
import { DataStatus } from "@/components/dashboard/data-status";
import { FastFlowPanel } from "@/components/dashboard/fast-flow-panel";
import { JackpotRadar } from "@/components/dashboard/jackpot-radar";
import { PaperPortfolioPanel } from "@/components/dashboard/paper-portfolio-panel";
import { QualificationDiagnostics } from "@/components/dashboard/qualification-diagnostics";
import { getDashboardStockData } from "@/data/dashboard-data";
import { getWalletDiscoveryData } from "@/data/wallet-discovery-data";
import { getFastFlowData } from "@/data/fast-flow-data";
import { getJackpotData } from "@/data/jackpot-data";
import { getPaperPortfolioData } from "@/data/paper-portfolio-data";
import { getQualificationData } from "@/data/qualification-data";
import { getMarketRadarData } from "@/data/market-radar-data";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [stockData, walletDiscovery, fastFlow, jackpot, paper, qualification, radar] = await Promise.all([
    getDashboardStockData(), getWalletDiscoveryData(), getFastFlowData(), getJackpotData(), getPaperPortfolioData(), getQualificationData(), getMarketRadarData(),
  ]);
  return <main>
    <section className="hero"><div><span className="eyebrow">MARKET INTELLIGENCE</span><h1>Market <em>radar</em></h1><p>Deterministic signals, ranked by opportunity. Every score is traceable to its evidence.</p><DataStatus mode={radar.mode} updatedAt={radar.updatedAt} message={radar.message} /></div><div className="last-scan"><span>INGESTION STATUS</span><strong>{radar.mode.toUpperCase()}</strong><small>{radar.message}</small></div></section>
    <section className="pulse-grid">{radar.pulse.map((item) => <article key={item.label}><span>{item.label}<i className={`source-badge source-badge--${item.dataMode ?? "unknown"}`}>{item.dataMode ?? "unknown"}</i></span><strong>{item.value}</strong><small className={item.tone}>{item.change}</small></article>)}</section>
    <section className="content-grid"><div><div className="section-heading"><div><span className="eyebrow">PERSISTED SIGNALS</span><h2>Top Opportunities</h2></div><button>All assets <span>→</span></button></div><div className="opportunities">{radar.opportunities.length ? radar.opportunities.map((item, index) => <OpportunityCard key={item.id} opportunity={item} rank={index + 1} />) : <div className="dashboard-empty"><strong>No verified opportunities</strong><span>No active persisted signals currently satisfy the dashboard query.</span></div>}</div></div><aside><RecentSignalsPanel signals={radar.recentSignals} /><div className="coverage"><span>DATABASE COVERAGE</span><div><strong>{radar.coverage.wallets}</strong><small>Wallets</small></div><div><strong>{radar.coverage.stocks}</strong><small>Stocks</small></div><div><strong>{radar.coverage.tokens}</strong><small>Tokens</small></div></div></aside></section>
    <WalletDiscoveryPanel data={walletDiscovery} /><FastFlowPanel data={fastFlow} /><JackpotRadar data={jackpot} /><PaperPortfolioPanel data={paper} /><QualificationDiagnostics data={qualification} />
    <section className="intelligence-grid intelligence-grid--single"><StockRadarPanel stocks={stockData.stocks} /></section>
    <footer>Market Intelligence Engine <span>V0.4 · RADAR {radar.mode.toUpperCase()} · STOCKS {stockData.mode.toUpperCase()} · WALLETS {walletDiscovery.mode.toUpperCase()} · PAPER ONLY</span></footer>
  </main>;
}
