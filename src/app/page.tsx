import { Suspense } from "react";
import Link from "next/link";
import { OpportunityCard } from "@/components/opportunity-card";
import { RecentSignalsPanel, StockRadarPanel } from "@/components/dashboard/intelligence-panels";
import { WalletDiscoveryPanel } from "@/components/dashboard/wallet-discovery-panel";
import { DataStatus } from "@/components/dashboard/data-status";
import { FastFlowPanel } from "@/components/dashboard/fast-flow-panel";
import { JackpotRadar } from "@/components/dashboard/jackpot-radar";
import { PaperPortfolioPanel } from "@/components/dashboard/paper-portfolio-panel";
import { QualificationDiagnostics } from "@/components/dashboard/qualification-diagnostics";
import { DashboardPanel, DashboardSection, PanelUnavailable } from "@/components/dashboard/panel-loading";
import { getDashboardStockData } from "@/data/dashboard-data";
import { getWalletDiscoveryData } from "@/data/wallet-discovery-data";
import { getFastFlowData } from "@/data/fast-flow-data";
import { getJackpotData } from "@/data/jackpot-data";
import { getPaperPortfolioSummaryData } from "@/data/paper-portfolio-data";
import { getQualificationData } from "@/data/qualification-data";
import { getMarketRadarData, type MarketRadarData } from "@/data/market-radar-data";
import styles from "@/components/dashboard/panel-loading.module.css";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  // One request-local read for status, pulse and signals. No cross-visitor cache
  // and no Promise.all barrier keeping unrelated panels from being displayed.
  const radar = getMarketRadarData();
  const loadRadar = () => radar;
  return <main>
    <section className="hero">
      <div>
        <span className="eyebrow">MARKET INTELLIGENCE</span>
        <h1>Market <em>radar</em></h1>
        <p>Deterministic signals, ranked by opportunity. Every score is traceable to its evidence.</p>
        <Suspense fallback={<div className={styles.status} role="status">Hämtar datastatus…</div>}>
          <DashboardSection title="Datastatus" load={loadRadar} render={data => <DataStatus mode={data.mode} updatedAt={data.updatedAt} message={radarMessage(data)} provider="Supabase observations" />} />
        </Suspense>
      </div>
      <div className="last-scan">
        <span>INGESTION STATUS</span>
        <Suspense fallback={<strong role="status">LOADING</strong>}>
          <DashboardSection title="Ingestion status" load={loadRadar} render={data => <><strong>{data.mode.toUpperCase()}</strong><small>{radarMessage(data)}</small></>} />
        </Suspense>
      </div>
    </section>

    <Suspense fallback={<PulseLoading />}>
      <DashboardSection title="Market pulse" load={loadRadar} render={data => <section className="pulse-grid">
        {data.pulse.map(item => <article key={item.label}>
          <span>{item.label}<i className={`source-badge source-badge--${item.dataMode ?? "unknown"}`}>{item.dataMode ?? "unknown"}</i></span>
          <strong>{item.value}</strong><small className={item.tone}>{item.change}</small>
        </article>)}
      </section>} />
    </Suspense>

    <DashboardPanel title="Top Opportunities & Recent Signals" rows={4}>
      <DashboardSection title="Market signals" load={loadRadar} render={data => <RadarSignals data={data} />} />
    </DashboardPanel>
    <DashboardPanel title="Wallet Candidates">
      <DashboardSection title="Wallet Candidates" load={getWalletDiscoveryData} render={data => data.mode === "degraded" && !data.candidates.length
        ? <PanelUnavailable title="Wallet Candidates" />
        : <WalletDiscoveryPanel data={data.mode === "degraded" ? { ...data, message: "Delar av wallet-underlaget kunde inte laddas." } : data} />} />
    </DashboardPanel>
    <div id="fast-flow">
      <DashboardPanel title="Fast Flow">
        <DashboardSection title="Fast Flow" load={getFastFlowData} render={data => data.mode === "degraded" && !data.items.length
          ? <PanelUnavailable title="Fast Flow" /> : <FastFlowPanel data={data} />} />
      </DashboardPanel>
    </div>
    <DashboardPanel title="Jackpot Radar">
      <DashboardSection title="Jackpot Radar" load={getJackpotData} render={data => <JackpotRadar data={data} />} />
    </DashboardPanel>
    <DashboardPanel title="Paper Portfolios" rows={2}>
      <DashboardSection title="Paper Portfolios" load={getPaperPortfolioSummaryData} render={data => <PaperPortfolioPanel data={data} />} />
    </DashboardPanel>
    <DashboardPanel title="Qualification Diagnostics">
      <DashboardSection title="Qualification Diagnostics" load={getQualificationData} render={data => <QualificationDiagnostics data={data} />} />
    </DashboardPanel>
    <DashboardPanel title="Stock Radar">
      <DashboardSection title="Stock Radar" load={getDashboardStockData} render={data => data.mode === "degraded" && !data.stocks.length
        ? <PanelUnavailable title="Stock Radar" /> : <section className="intelligence-grid intelligence-grid--single"><div>
        <DataStatus mode={data.mode} updatedAt={data.updatedAt} message={data.message} provider={data.provider} />
        <StockRadarPanel stocks={data.stocks} />
      </div></section>} />
    </DashboardPanel>
    <footer>Market Intelligence Engine <span>Status och tid visas per datakälla · PAPER ONLY</span></footer>
  </main>;
}

function radarMessage(data: MarketRadarData) {
  return data.mode === "degraded" ? "Marknadsdata kunde inte laddas. Försök igen." : data.message;
}

function PulseLoading() {
  return <section className="pulse-grid" aria-label="Market pulse laddas" aria-busy="true">
    {["S&P 500", "NASDAQ", "BTC", "Market regime"].map(label => <article key={label}>
      <span>{label}</span><strong>LOADING</strong><small>Hämtar data…</small>
    </article>)}
  </section>;
}

function RadarSignals({ data }: { data: MarketRadarData }) {
  if (data.mode === "degraded") return <PanelUnavailable title="Market signals & database coverage" />;
  return <section className="content-grid">
    <div>
      <div className="section-heading">
        <div><span className="eyebrow">PERSISTED SIGNALS</span><h2>Top Opportunities</h2></div>
        <Link className={styles.link} href="/signals">Alla signaler →</Link>
      </div>
      <div className="opportunities">
        {data.opportunities.length ? data.opportunities.map((item, index) => <OpportunityCard key={item.id} opportunity={item} rank={index + 1} />) : <div className="dashboard-empty">
          <strong>No verified opportunities</strong><span>No active persisted signals currently satisfy the dashboard query.</span>
        </div>}
      </div>
    </div>
    <aside>
      <RecentSignalsPanel signals={data.recentSignals} />
      <div className="coverage"><span>DATABASE COVERAGE</span>
        <div><strong>{data.coverage.wallets}</strong><small>Wallets</small></div>
        <div><strong>{data.coverage.stocks}</strong><small>Stocks</small></div>
        <div><strong>{data.coverage.tokens}</strong><small>Tokens</small></div>
      </div>
    </aside>
  </section>;
}
