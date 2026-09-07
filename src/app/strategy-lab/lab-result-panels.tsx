import { CapitalProjection } from "./capital-projection";
import type { resolveLabResult, LabTrade } from "./lab-workspace-state";
import styles from "./strategy-lab.module.css";

export function LabResultPanels({ result }: { result: ReturnType<typeof resolveLabResult> }) {
  if (result.status !== "ready") {
    const text = {
      empty: ["INGET RESULTAT VALT", "Kör ett backtest eller välj en sparad körning ovan. Ingen äldre körning väljs automatiskt."],
      running: ["BACKTEST PÅGÅR", "Resultatet visas när körningen är klar. Ett äldre resultat visas inte som om det vore det nya."],
      loading: ["HÄMTAR VALD KÖRNING", "Hämtar just det sparade körnings-ID:t. Andra körningar används inte som ersättning."],
      failed: ["INGET NYTT RESULTAT", "Körningen kunde inte slutföras. Dina val är kvar. Felet ovan beskriver nästa steg."],
      unavailable: ["VALT RESULTAT ÄR INTE TILLGÄNGLIGT", "Körningen saknas eller kunde inte läsas. Försök ladda om eller välj ett annat sparat resultat. Vi visar inte en annan körning automatiskt."],
    }[result.status];
    return <div className={styles.empty} role="status"><strong>{text[0]}</strong><span>{text[1]}</span></div>;
  }
  const run = result.run;
  return <div data-result-run-id={run.id}>
    <div className={styles.resultIdentity}>
      <strong>{run.symbol} · {run.strategyName} · {run.timeframe} · v{run.version}</strong>
      <span>Run ID: {run.id}</span>
      <span>Informationsgräns: {run.cutoffAt} · status {run.status}</span>
      <span>{run.candleCount} candles · {run.setupCount} setups · {run.tradeCount} trades · minsta statistiska underlag {run.minimumSampleSize}</span>
      <p>Sparad historisk research, inte en prognos eller ett bevis på framtida vinst. Startdatum finns inte lagrat i äldre körningar; formulärets datum beskriver nästa beställning.</p>
    </div>
    {run.trades === null ? <div className={styles.empty} role="status"><strong>HANDELSUNDERLAGET ÄR INTE KOMPLETT</strong><span>Körningen rapporterar {run.tradeCount} trades, men kompletta giltiga handelsrader kunde inte laddas. Kapital och diagram beräknas inte från ett ofullständigt urval.</span></div>
      : !run.trades.length ? <div className={styles.empty} role="status"><strong>KÖRNING KLAR — 0 TRADES</strong><span>{run.candleCount ? "Candles utvärderades, men ingen trade uppfyllde reglerna." : "Körningen hade inga candles att utvärdera."} Det går inte att dra någon slutsats om lönsamhet. Vi visar inte ett oförändrat kapital som ett uppmätt resultat.</span></div>
        : <>
          <header><div><p>CAPITAL OUTCOME</p><h2>Kapitalresultat</h2></div><span>Hypotetisk översättning av den valda körningens {run.tradeCount} trades</span></header>
          {run.tradeCount < run.minimumSampleSize && <p className={styles.resultNotice}>För litet statistiskt underlag: {run.tradeCount}/{run.minimumSampleSize} trades. Kapitalexemplet är beskrivande, inte verifierad edge.</p>}
          <CapitalProjection trades={run.trades}/>
          <header><div><p>VISUAL REPLAY</p><h2>Equity path — vald körning</h2></div><span>Samma Run ID: {run.id}</span></header>
          <div className={styles.visualGrid}><EquityCurve trades={run.trades}/><div className={styles.tradeLedger}>{run.trades.map((trade, index) => <div key={trade.trade_key}><span>#{index + 1} · {trade.side} · {trade.entered_at}</span><b className={trade.r_multiple >= 0 ? styles.positive : styles.negative}>{trade.r_multiple.toFixed(2)}R</b></div>)}</div></div>
        </>}
  </div>;
}

function EquityCurve({ trades }: { trades: LabTrade[] }) {
  const values = [0];
  for (const trade of trades) values.push(values.at(-1)! + trade.r_multiple);
  if (values.some(value => !Number.isFinite(value))) return <div className={styles.empty}>Diagrammet kan inte beräknas från dessa värden.</div>;
  const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max - min);
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * 100},${90 - (value - min) / range * 80}`).join(" ");
  return <div className={styles.chart}><div><small>EQUITY CURVE</small><strong>{values.at(-1)!.toFixed(2)}R</strong></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Historical cumulative R"><line x1="0" y1="90" x2="100" y2="90"/><polyline points={points}/></svg><footer>{trades.length} trades · range {min.toFixed(2)}R to {max.toFixed(2)}R</footer></div>;
}
