import Link from "next/link";
import { notFound } from "next/navigation";
import { getPaperTradeDetail } from "@/data/paper-portfolio-data";
export const dynamic = "force-dynamic";
export default async function TradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    { data, error } = await getPaperTradeDetail(id);
  if (!data && !error) notFound();
  if (!data)
    return (
      <main className="paper-page">
        <Link href="/paper" className="back-link">
          ← Paper Portfolio
        </Link>
        <div className="verification-banner">
          <strong>TRADE UNAVAILABLE</strong>
          <p>{error}</p>
        </div>
      </main>
    );
  const evaluation = Array.isArray(data.paper_policy_evaluations)
      ? data.paper_policy_evaluations[0]
      : data.paper_policy_evaluations,
    policy = Array.isArray(data.paper_policies)
      ? data.paper_policies[0]
      : data.paper_policies,
    asset = Array.isArray(data.assets) ? data.assets[0] : data.assets;
  return (
    <main className="paper-page">
      <Link href="/paper" className="back-link">
        ← Paper Portfolio
      </Link>
      <header className="wallet-hero">
        <div>
          <span className="eyebrow">PAPER TRADE DIAGNOSTICS</span>
          <h1>{asset?.symbol ?? "UNKNOWN"}</h1>
          <p>{data.id}</p>
        </div>
        <span className="jackpot-state">{data.status}</span>
      </header>
      <section className="radar-panel">
        <dl className="jackpot-facts">
          <div>
            <dt>Why entered / rejected?</dt>
            <dd>{evaluation?.reason ?? data.reason ?? "Pending execution"}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>{policy?.policy_version}</dd>
          </div>
          <div>
            <dt>Candidate revision</dt>
            <dd>{evaluation?.candidate_revision ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Known inputs</dt>
            <dd>
              <pre>
                {JSON.stringify(evaluation?.known_inputs ?? {}, null, 2)}
              </pre>
            </dd>
          </div>
          <div>
            <dt>Entry delay</dt>
            <dd>{data.configured_entry_delay_ms} ms</dd>
          </div>
          <div>
            <dt>Execution time</dt>
            <dd>{data.simulated_execution_at}</dd>
          </div>
          <div>
            <dt>Liquidity used</dt>
            <dd>{data.liquidity_used ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>
              <pre>{JSON.stringify(data.fees, null, 2)}</pre>
            </dd>
          </div>
          <div>
            <dt>Slippage</dt>
            <dd>
              <pre>{JSON.stringify(data.slippage, null, 2)}</pre>
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
