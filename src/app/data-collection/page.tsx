import { createServiceClient } from "@/lib/supabase/server";
import {
  ageLabel,
  classifyOperationsStatus,
  SAFE_MANUAL_JOB_TYPES,
  pipelineReadStatus as pipelineStatus,
  processedRecordCount as metricRecords,
  type OperationsStatus,
} from "@/domain/data-operations";
import { ManualRunForm } from "./manual-run-form";
import { readCount, readQuery } from "@/data/query-result";
import { isOperatorAuthConfigured } from "@/lib/operator-session";
import styles from "./data-collection.module.css";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  job_kind: string;
  provider: string;
  status: string;
  records_processed: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};
type Job = {
  id: string;
  job_key: string;
  job_type: string;
  status: string;
  enabled: boolean;
  interval_seconds: number;
  next_run_at: string;
  last_successful_run_at: string | null;
  last_heartbeat_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
  rate_limit_budget: Record<string, number>;
  metrics: Record<string, unknown>;
};

const providerDefinitions = [
  {
    name: "Finnhub",
    matcher: /finnhub/i,
    freshness: 900,
  },
  {
    name: "Helius",
    matcher: /helius|solana-rpc/i,
    freshness: 900,
  },
  {
    name: "Birdeye",
    matcher: /birdeye/i,
    freshness: 1800,
  },
  {
    name: "DexScreener",
    matcher: /dexscreener/i,
    freshness: 600,
  },
  {
    name: "GeckoTerminal",
    matcher: /gecko/i,
    freshness: 600,
  },
] as const;

export default async function DataCollectionPage() {
  const db = createServiceClient();
  const until = new Date().toISOString();
  const since = new Date(Date.parse(until) - 86_400_000).toISOString();
  const [
    jobsResult,
    runsResult,
    jobRunsResult,
    windowResult,
    prices,
    candles,
    transactions,
    tokens,
    wallets,
    pools,
    discoveryCandidates,
    promotionEvaluations,
  ] = await Promise.all([
    readQuery(db.from("scheduled_jobs").select("id,job_key,job_type,status,enabled,interval_seconds,next_run_at,last_successful_run_at,last_heartbeat_at,consecutive_failures,last_error,metrics").order("priority")),
    readQuery(db
      .from("ingestion_runs")
      .select(
        "id,job_kind,provider,status,records_processed,started_at,finished_at,error_message",
      )
      .order("started_at", { ascending: false })
      .limit(300)),
    readQuery(db
      .from("scheduled_job_runs")
      .select("id,job_id,status,started_at,finished_at,records_processed,error")
      .order("started_at", { ascending: false })
      .limit(120)),
    readQuery(db.rpc("data_operations_window_summary", { p_since: since, p_until: until })),
    readCount(db
      .from("market_prices")
      .select("*", { count: "exact", head: true })
      .gte("captured_at", since).lt("captured_at", until)),
    readCount(db
      .from("market_candles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since).lt("created_at", until)),
    readCount(db
      .from("wallet_transactions")
      .select("*", { count: "exact", head: true })
      .gte("ingested_at", since).lt("ingested_at", until)),
    readCount(db
      .from("crypto_tokens")
      .select("*", { count: "exact", head: true })
      .gte("first_seen_at", since).lt("first_seen_at", until)),
    readCount(db
      .from("wallets")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since).lt("created_at", until)),
    readCount(db
      .from("pool_discovery_observations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since).lt("created_at", until)),
    readQuery(db.rpc("wallet_promotion_read_counts")),
    readQuery(db
      .from("wallet_promotion_evaluations")
      .select("decided_state,blockers,available_at")
      .order("available_at", { ascending: false })
      .limit(500)),
  ]);
  const jobs = (jobsResult.data ?? []) as Job[];
  const runs = (runsResult.data ?? []) as Run[];
  const providers = providerDefinitions.map((definition) =>
    providerHealth(definition, runs),
  );
  const safeJobs = jobs.filter((job) =>
    SAFE_MANUAL_JOB_TYPES.has(job.job_type),
  );
  const enabledJobs = jobs.filter((job) => job.enabled);
  const healthyJobs = enabledJobs.filter(
    (job) => pipelineStatus(job, new Date(until)) === "LIVE",
  ).length;
  const promotionCounts = discoveryCandidates.data;
  const windowCounts = windowResult.data;
  const blockerCounts = new Map<string, number>();
  for (const evaluation of promotionEvaluations.data ?? [])
    for (const blocker of Array.isArray(evaluation.blockers)
      ? evaluation.blockers
      : [])
      if (typeof blocker === "string")
        blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
  const topPromotionBlockers = [...blockerCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <small>DATA OPERATIONS</small>
          <h1>Provider truth, in one place.</h1>
          <p>
            Live ingestion health, freshness, coverage and failures. Missing
            data stays explicit.
          </p>
        </div>
        <div className={styles.heroStatus}>
          <span>PIPELINES WITH RECENT SUCCESS</span>
          <strong>
            {jobsResult.status === "error" ? "—" : `${healthyJobs}/${enabledJobs.length}`}
          </strong>
          <p>Job freshness is not proof of usable data or trading readiness.</p>
        </div>
      </section>
      <section className={styles.summary}>
        <Stat label="Quote timestamps · 24h" value={prices.data} />
        <Stat label="Imported candles · 24h" value={candles.data} />
        <Stat label="Imported wallet tx · 24h" value={transactions.data} />
        <Stat label="New tokens · 24h" value={tokens.data} />
        <Stat label="New wallets · 24h" value={wallets.data} />
        <Stat label="Imported pools · 24h" value={pools.data} />
      </section>
      <p className={styles.readNotice}>Tidsfönster: {formatDate(since)}–{formatDate(until)} Stockholm. Noll betyder en lyckad läsning utan poster; — betyder att värdet inte kunde laddas. Gamla prisstämplar kan bero på stängd marknad.</p>
      {[prices, candles, transactions, tokens, wallets, pools].some(result => result.status === "error") && <ReadError text="En eller flera dataräknare kunde inte laddas. Fungerande räknare visas fortfarande." />}
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="WALLET INTELLIGENCE"
          title="Candidate promotion"
          meta="wallet-candidate-promotion-v1"
        />
        <div className={styles.promotionGrid}>
          <PromotionStat
            label="Discovered candidates"
            value={promotionCounts?.total ?? null}
          />
          <PromotionStat label="Tracked" value={promotionCounts?.tracked ?? null} />
          <PromotionStat label="Reviewing" value={promotionCounts?.reviewing ?? null} />
          <PromotionStat label="Verified" value={promotionCounts?.verified ?? null} />
          <PromotionStat label="Rejected" value={promotionCounts?.rejected ?? null} />
        </div>
        <div className={styles.promotionDetail}>
          <div>
            <span>CURRENTLY BLOCKED</span>
            <strong>{promotionCounts?.candidate ?? "—"}</strong>
            <p>
              Candidates remain untracked until every discovery requirement
              passes.
            </p>
          </div>
          <div>
            <span>TOP BLOCKERS · LATEST 500 EVALUATIONS</span>
            {topPromotionBlockers.length ? (
              topPromotionBlockers.map(([blocker, count]) => (
                <p key={blocker}>
                  <strong>{count}</strong> {humanize(blocker)}
                </p>
              ))
            ) : (
              <p>{promotionEvaluations.status === "error" ? "Bedömningarna kunde inte laddas." : "No immutable promotion evaluations yet."}</p>
            )}
          </div>
        </div>
        {discoveryCandidates.status === "error" && <ReadError text="Walletsammanfattningen kunde inte laddas. Kontrollera att läsmodellens migration är applicerad." />}
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="PROVIDER NETWORK"
          title="Live data sources"
          meta="provider-specific observations; no inferred connection status"
        />
        {runsResult.status === "error" && <ReadError text="Providerhistoriken kunde inte laddas. Inga anslutningar antas vara friska." />}
        <div className={styles.providerGrid}>
          {providers.map((provider) => (
            <article className={styles.provider} key={provider.name}>
              <header>
                <h3>{provider.name}</h3>
                <Status status={provider.status} />
              </header>
              <strong>{ageLabel(provider.lastSuccessAt)}</strong>
              <p>
                {provider.lastSuccessAt
                  ? formatDate(provider.lastSuccessAt)
                  : "No persisted successful run"}
              </p>
              <footer>
                <span>
                  {provider.records?.toLocaleString("sv-SE") ?? "—"} latest processed records
                </span>
                <span>
                  {provider.latestError ?? "No error in loaded provider history"}
                </span>
              </footer>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.split}>
        <section className={styles.panel}>
          <PanelHeader
            eyebrow="SAFE CONTROL"
            title="Queue ingestion"
            meta="operator protected"
          />
          <ManualRunForm
            jobs={safeJobs.map(({ job_key, job_type }) => ({ job_key, job_type }))}
            enabled={isOperatorAuthConfigured()}
          />
        </section>
        <section className={styles.panel}>
          <PanelHeader
            eyebrow="COVERAGE"
            title="Provider diagnostics"
            meta="exact aggregate · last 24 hours"
          />
          <div className={styles.coverageList}>
            <Coverage
              label="Processed records (not unique observations)"
              value={windowCounts?.records_processed ?? null}
            />
            <Coverage
              label="Successful ingestion runs"
              value={windowCounts?.succeeded ?? null}
            />
            <Coverage
              label="Failed ingestion runs"
              value={windowCounts?.failed ?? null}
            />
            <Coverage
              label="Provider errors"
              value={windowCounts?.provider_errors ?? null}
            />
          </div>
          {windowResult.status === "error" && <ReadError text="Dygnsaggregatet kunde inte laddas. En begränsad historiklista används inte som ersättning." />}
        </section>
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="SCHEDULER"
          title="Pipeline status"
          meta={jobsResult.status === "error" ? "Läsfel" : `${jobs.length} registered jobs`}
        />
        {jobsResult.status === "error" && <ReadError text="Schemaläggningen kunde inte laddas." />}
        <div className={styles.jobTable}>
          <div className={styles.tableHead}>
            <span>Pipeline</span>
            <span>Status</span>
            <span>Last success</span>
            <span>Records</span>
            <span>Failures / next</span>
          </div>
          {jobs.map((job) => (
            <article className={styles.jobRow} key={job.id}>
              <div>
                <strong>{humanize(job.job_type)}</strong>
                <small>{job.job_key}</small>
              </div>
              <Status
                status={
                  pipelineStatus(job, new Date(until))
                }
              />
              <div>
                <strong>{ageLabel(job.last_successful_run_at)}</strong>
                <small>
                  {job.last_heartbeat_at
                    ? `Heartbeat ${formatDate(job.last_heartbeat_at)}`
                    : "No heartbeat"}
                </small>
              </div>
              <strong>
                {metricRecords(job.metrics)?.toLocaleString("sv-SE") ?? "—"}
              </strong>
              <div>
                <strong>{job.consecutive_failures} failures</strong>
                <small>
                  {job.last_error
                    ? "Worker error recorded; inspect protected server logs."
                    : `Next ${formatDate(job.next_run_at)}`}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="RUN HISTORY"
          title="Latest scheduler activity"
          meta={jobRunsResult.status === "error" ? "Läsfel" : `${jobRunsResult.data?.length ?? 0} loaded`}
        />
        {jobRunsResult.status === "error" && <ReadError text="Körningshistoriken kunde inte laddas." />}
        <div className={styles.history}>
          {(jobRunsResult.data ?? []).slice(0, 20).map((run: any) => {
            const job = jobs.find((item) => item.id === run.job_id);
            return (
              <article key={run.id}>
                <div>
                  <strong>{job?.job_key ?? "unknown-job"}</strong>
                  <small>{formatDate(run.started_at)}</small>
                </div>
                <span data-run-status={run.status}>{run.status}</span>
                <strong>{run.records_processed} records</strong>
                <p>
                  {run.error
                    ? "Run failed; inspect protected server logs."
                    : run.finished_at
                      ? `Finished ${formatDate(run.finished_at)}`
                      : "In progress"}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function providerHealth(
  definition: (typeof providerDefinitions)[number],
  runs: Run[],
) {
  const matchingRuns = runs.filter((run) =>
    definition.matcher.test(run.provider),
  );
  const successful = matchingRuns.find(
    (run) => run.status === "succeeded" && run.finished_at,
  );
  const latest = matchingRuns[0];
  const lastSuccessAt =
    successful?.finished_at ?? null;
  return {
    name: definition.name,
    lastSuccessAt,
    records:
      successful?.records_processed ?? null,
    latestError:
      latest?.status === "failed"
        ? "Provider error recorded; inspect protected server logs."
        : null,
    status: classifyOperationsStatus({
      lastSuccessAt,
      latestStatus: latest?.status,
      freshnessSeconds: definition.freshness,
    }),
  };
}

function Status({ status }: { status: OperationsStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      {status}
    </span>
  );
}
function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value?.toLocaleString("sv-SE") ?? "—"}</strong>
    </article>
  );
}
function PromotionStat({ label, value }: { label: string; value: number | null }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value?.toLocaleString("sv-SE") ?? "—"}</strong>
    </article>
  );
}
function Coverage({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value?.toLocaleString("sv-SE") ?? "—"}</strong>
    </div>
  );
}
function PanelHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta: string;
}) {
  return (
    <header className={styles.panelHeader}>
      <div>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
      </div>
      <span>{meta}</span>
    </header>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function ReadError({ text }: { text: string }) {
  return <p role="alert" className={styles.readError}>{text}</p>;
}
