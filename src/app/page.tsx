import { OpportunityCard } from "@/components/opportunity-card";
import { marketPulse, opportunities } from "@/data/mock-market";

export default function Dashboard() {
  return (
    <main>
      <section className="hero">
        <div><span className="eyebrow">LIVE INTELLIGENCE • 16 AUG 2026</span><h1>Market <em>radar</em></h1><p>Deterministic signals, ranked by opportunity. Every score is traceable to its evidence.</p></div>
        <div className="last-scan"><span>LAST FULL SCAN</span><strong>18:42:08</strong><small>2,418 assets · 100 wallets</small></div>
      </section>

      <section className="pulse-grid">
        {marketPulse.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small className={item.tone}>{item.change}</small></article>)}
      </section>

      <section className="content-grid">
        <div>
          <div className="section-heading"><div><span className="eyebrow">RANKED NOW</span><h2>Top opportunities</h2></div><button>All assets <span>→</span></button></div>
          <div className="opportunities">{opportunities.map((item, index) => <OpportunityCard key={item.id} opportunity={item} rank={index + 1} />)}</div>
        </div>
        <aside>
          <div className="aside-heading"><span className="live-dot" /> LIVE SIGNALS</div>
          <div className="timeline">
            <div><time>18:44</time><p><strong>Wallet cluster detected</strong><span>5 elite wallets entered LAYOOO</span></p><b>+84</b></div>
            <div><time>18:41</time><p><strong>Unusual volume</strong><span>AMD volume 2.7× 20-day average</span></p><b>+12</b></div>
            <div><time>18:37</time><p><strong>Risk changed</strong><span>SOL concentration risk increased</span></p><b className="red">+8</b></div>
            <div><time>18:29</time><p><strong>Estimate revision</strong><span>NVDA FY estimate raised by 3.2%</span></p><b>+9</b></div>
          </div>
          <div className="coverage"><span>COVERAGE</span><div><strong>100</strong><small>Wallets</small></div><div><strong>100</strong><small>Stocks</small></div><div><strong>2,218</strong><small>Tokens</small></div></div>
        </aside>
      </section>
      <footer>Market Intelligence Engine <span>V0.1 · PAPER ONLY · NOT FINANCIAL ADVICE</span></footer>
    </main>
  );
}

