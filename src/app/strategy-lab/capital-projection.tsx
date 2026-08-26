"use client";

import { useMemo, useState } from "react";
import styles from "./strategy-lab.module.css";

type Trade = { trade_key: string; exited_at: string; r_multiple: number | string };
const money = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 });

export function CapitalProjection({ trades }: { trades: Trade[] }) {
  const [initialCapital, setInitialCapital] = useState(10_000);
  const [riskPercent, setRiskPercent] = useState(1);
  const result = useMemo(() => {
    let equity = initialCapital;
    for (const trade of [...trades].sort((a, b) => a.exited_at.localeCompare(b.exited_at))) {
      equity += equity * (riskPercent / 100) * Number(trade.r_multiple);
    }
    const pnl = equity - initialCapital;
    return { equity, pnl, returnPercent: initialCapital > 0 ? (pnl / initialCapital) * 100 : null };
  }, [initialCapital, riskPercent, trades]);

  if (!trades.length) return <div className={styles.capitalEmpty}>
    <strong>KAPITALRESULTAT KAN INTE BERÄKNAS</strong>
    <span>Backtestet skapade inga trades. Därför visar vi inte 10 000 kr → 10 000 kr som om strategin hade testats.</span>
  </div>;

  const positive = result.pnl >= 0;
  return <div className={styles.capitalProjection}>
    <div className={styles.capitalControls}>
      <label>Startkapital<input type="number" min="100" step="1000" value={initialCapital} onChange={(event) => setInitialCapital(Math.max(100, Number(event.target.value) || 100))}/></label>
      <label>Risk per trade<select value={riskPercent} onChange={(event) => setRiskPercent(Number(event.target.value))}><option value={0.5}>0,5%</option><option value={1}>1%</option><option value={2}>2%</option></select></label>
    </div>
    <div className={styles.capitalResult}>
      <div><small>OM DU BÖRJADE MED</small><strong>{money.format(initialCapital)}</strong></div>
      <div><small>HADE DU SLUTAT MED</small><strong>{money.format(result.equity)}</strong></div>
      <div><small>{positive ? "VINST" : "FÖRLUST"}</small><strong className={positive ? styles.positive : styles.negative}>{positive ? "+" : ""}{money.format(result.pnl)}</strong></div>
      <div><small>AVKASTNING</small><strong className={positive ? styles.positive : styles.negative}>{positive ? "+" : ""}{result.returnPercent?.toFixed(2)}%</strong></div>
    </div>
    <p className={styles.capitalDisclaimer}>Hypotetisk modell baserad på {trades.length} historiska trades och {riskPercent}% av aktuellt kapital i risk per trade. Avgifter och slippage ingår endast om de finns i backtestets regelversion.</p>
  </div>;
}
