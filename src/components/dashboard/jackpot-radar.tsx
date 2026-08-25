import Link from "next/link";
import type { getJackpotData } from "@/data/jackpot-data";

export function JackpotRadar({
  data,
}: {
  data: Awaited<ReturnType<typeof getJackpotData>>;
}) {
  return (
    <section className="radar-panel jackpot-panel" id="jackpot">
      <div className="panel-title jackpot-title">
        <div>
          <span className="eyebrow">RESEARCH DATASET</span>
          <h2>
            Jackpot Radar <span aria-hidden>◎</span>
          </h2>
          <p>Early observations and evidence — never execution decisions.</p>
        </div>
        <span className={`jackpot-mode jackpot-mode--${data.mode}`}>
          {data.mode}
        </span>
      </div>
      {data.items.length ? (
        <>
          <div className="jackpot-head">
            <span>Asset</span>
            <span>State</span>
            <span>Wallet evidence</span>
            <span>Coverage</span>
            <span>Safety</span>
            <span />
          </div>
          <div className="jackpot-list">
            {data.items.map((item) => (
              <Link
                href={`/jackpot/${item.id}`}
                key={item.id}
                aria-label={`Open details for ${item.symbol}`}
              >
                <div className="jackpot-asset">
                  <strong>{item.symbol}</strong>
                  <time>{formatRelative(item.detectedAt)}</time>
                </div>
                <span
                  className={`jackpot-state jackpot-state--${item.state.toLowerCase()}`}
                >
                  {item.state.replaceAll("_", " ")}
                </span>
                <div className="jackpot-wallets">
                  <strong>{item.raw ?? "—"}</strong>
                  <span>raw</span>
                  <i />
                  <strong>{item.independent ?? "—"}</strong>
                  <span>independent</span>
                </div>
                <div className="jackpot-coverage">
                  <strong>
                    {item.coverage === null ? "Unknown" : `${item.coverage}%`}
                  </strong>
                  <span className="coverage-track">
                    <i style={{ width: `${item.coverage ?? 0}%` }} />
                  </span>
                </div>
                <div className="jackpot-safety">
                  <span
                    className={`safety-dot safety-dot--${item.safety.toLowerCase()}`}
                  />{" "}
                  <strong>{item.safety}</strong>
                  <small>No execution</small>
                </div>
                <span className="jackpot-open">
                  View <b>→</b>
                </span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="discovery-empty">
          <strong>No jackpot candidates yet</strong>
          <span>
            Collector stores evidence only; it never creates a BUY decision.
          </span>
        </div>
      )}
    </section>
  );
}

function formatRelative(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
