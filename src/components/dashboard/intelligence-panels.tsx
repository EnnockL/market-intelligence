import type { RecentSignal, SmartMoneyCluster, StockRadarItem, WatchlistAsset } from "@/domain/market";

export function SmartMoneyPanel({ clusters }: { clusters: SmartMoneyCluster[] }) {
  return <section className="radar-panel"><PanelTitle kicker="ON-CHAIN" title="Crypto Smart Money" /><div className="compact-list">{clusters.map((item) => <div key={item.token}><div className="compact-symbol"><strong>{item.token}</strong><span>{item.walletCount} wallets · {item.windowMinutes} min</span></div><div><strong>{item.averageWalletScore}</strong><span>avg wallet</span></div><div><strong>{item.signalScore}</strong><span>signal</span></div><i className={`risk-pill risk-pill--${item.risk}`}>{item.risk}</i></div>)}</div></section>;
}

export function StockRadarPanel({ stocks }: { stocks: StockRadarItem[] }) {
  return <section className="radar-panel"><PanelTitle kicker="EQUITIES" title="Stock Radar" /><div className="compact-list">{stocks.map((item) => <div key={item.symbol}><div className="compact-symbol"><strong>{item.symbol}</strong><span>{item.catalyst}</span></div><span className={`direction direction--${item.signal}`}>{item.signal}</span><strong className="compact-score">{item.score}</strong><span className={item.change >= 0 ? "positive" : "negative"}>{item.change >= 0 ? "+" : ""}{item.change}%</span></div>)}</div></section>;
}

export function RecentSignalsPanel({ signals }: { signals: RecentSignal[] }) {
  return <section className="radar-panel"><PanelTitle kicker="LIVE FEED" title="Recent Signals" /><div className="signal-list">{signals.map((item) => <div key={item.id}><time>{item.occurredAt}</time><strong>{item.symbol}</strong><span>{item.label}</span><b className={item.scoreImpact >= 0 ? "positive" : "negative"}>{item.scoreImpact >= 0 ? "+" : ""}{item.scoreImpact}</b></div>)}</div></section>;
}

export function WatchlistPanel({ assets }: { assets: WatchlistAsset[] }) {
  return <section className="radar-panel" id="watchlist"><PanelTitle kicker="PERSONAL" title="Watchlist" /><div className="compact-list watchlist-list">{assets.map((item) => <div key={item.symbol}><div className="compact-symbol"><strong>{item.symbol}</strong><span>{item.name}</span></div><span className={`tag tag--${item.kind}`}>{item.kind}</span><strong>${item.price.toLocaleString("en-US")}</strong><span className={item.change >= 0 ? "positive" : "negative"}>{item.change >= 0 ? "+" : ""}{item.change}%</span><b>{item.score}</b></div>)}</div></section>;
}

function PanelTitle({ kicker, title }: { kicker: string; title: string }) {
  return <div className="panel-title"><div><span className="eyebrow">{kicker}</span><h2>{title}</h2></div><button aria-label={`Open ${title}`}>→</button></div>;
}

