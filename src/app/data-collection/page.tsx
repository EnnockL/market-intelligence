import { createServiceClient } from "@/lib/supabase/server";
import {
  ageLabel,
  classifyOperationsStatus,
  SAFE_MANUAL_JOB_TYPES,
  type OperationsStatus,
} from "@/domain/data-operations";
import { ManualRunForm } from "./manual-run-form";
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
    fallbackJobs: ["STOCK_INGESTION", "CANDLE_INGESTION", "NEWS_INGESTION"],
    freshness: 900,
  },
  {
    name: "Helius",
    matcher: /helius|solana-rpc/i,
    fallbackJobs: ["WALLET_INGESTION", "WALLET_DISCOVERY"],
    freshness: 900,
  },
  {
    name: "Birdeye",
    matcher: /birdeye/i,
    fallbackJobs: ["DATA_GAP_CLOSURE"],
    freshness: 1800,
  },
  {
    name: "DexScreener",
    matcher: /dexscreener/i,
    fallbackJobs: ["CRYPTO_MARKET", "POOL_DISCOVERY"],
    freshness: 600,
  },
  {
    name: "GeckoTerminal",
    matcher: /gecko/i,
    fallbackJobs: ["CRYPTO_MARKET", "POOL_DISCOVERY"],
    freshness: 600,
  },
] as const;

export default async function DataCollectionPage() {
  const db = createServiceClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [
    jobsResult,
    runsResult,
    jobRunsResult,
    errorsResult,
    prices,
    candles,
    transactions,
    tokens,
    wallets,
    pools,
    discoveryCandidates,
    promotionEvaluations,
  ] = await Promise.all([
    db.from("scheduled_jobs").select("*").order("priority"),
    db
      .from("ingestion_runs")
      .select(
        "id,job_kind,provider,status,records_processed,started_at,finished_at,error_message",
      )
      .order("started_at", { ascending: false })
      .limit(300),
    db
      .from("scheduled_job_runs")
      .select("id,job_id,status,started_at,finished_at,records_processed,error")
      .order("started_at", { ascending: false })
      .limit(120),
    db
      .from("provider_errors")
      .select(
        "id,provider,error_code,message,retryable,http_status,occurred_at",
      )
      .order("occurred_at", { ascending: false })
      .limit(80),
    db
      .from("market_prices")
      .select("*", { count: "exact", head: true })
      .gte("captured_at", since),
    db
      .from("market_candles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since),
    db
      .from("wallet_transactions")
      .select("*", { count: "exact", head: true })
      .gte("ingested_at", since),
    db
      .from("crypto_tokens")
      .select("*", { count: "exact", head: true })
      .gte("first_seen_at", since),
    db
      .from("wallets")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since),
    db
      .from("pool_discovery_observations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since),
    db.from("wallet_discovery_candidates").select("status", { count: "exact" }),
    db
      .from("wallet_promotion_evaluations")
      .select("decided_state,blockers,available_at")
      .order("available_at", { ascending: false })
      .limit(500),
  ]);
  const jobs = (jobsResult.data ?? []) as Job[];
  const runs = (runsResult.data ?? []) as Run[];
  const providers = providerDefinitions.map((definition) =>
    providerHealth(definition, runs, jobs),
  );
  const safeJobs = jobs.filter((job) =>
    SAFE_MANUAL_JOB_TYPES.has(job.job_type),
  );
  const enabledJobs = jobs.filter((job) => job.enabled);
  const healthyJobs = enabledJobs.filter(
    (job) => job.status === "HEALTHY",
  ).length;
  const candidateRows = discoveryCandidates.data ?? [];
  const promotionCounts = Object.fromEntries(
    ["candidate", "tracked", "reviewing", "verified", "rejected"].map(
      (state) => [
        state,
        candidateRows.filter((row: any) => row.status === state).length,
      ],
    ),
  );
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
          <span>PIPELINES ONLINE</span>
          <strong>
            {healthyJobs}/{enabledJobs.length}
          </strong>
          <p>Execution is outside this control plane.</p>
        </div>
      </section>
      <section className={styles.summary}>
        <Stat label="Prices · 24h" value={prices.count ?? 0} />
        <Stat label="Candles · 24h" value={candles.count ?? 0} />
        <Stat label="Wallet tx · 24h" value={transactions.count ?? 0} />
        <Stat label="Tokens · 24h" value={tokens.count ?? 0} />
        <Stat label="New tracked · 24h" value={wallets.count ?? 0} />
        <Stat label="Pools · 24h" value={pools.count ?? 0} />
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="WALLET INTELLIGENCE"
          title="Candidate promotion"
          meta="wallet-candidate-promotion-v1"
        />
        <div className={styles.promotionGrid}>
          <PromotionStat
            label="Discovered candidates"
            value={candidateRows.length}
          />
          <PromotionStat label="Tracked" value={promotionCounts.tracked} />
          <PromotionStat label="Reviewing" value={promotionCounts.reviewing} />
          <PromotionStat label="Verified" value={promotionCounts.verified} />
          <PromotionStat label="Rejected" value={promotionCounts.rejected} />
        </div>
        <div className={styles.promotionDetail}>
          <div>
            <span>CURRENTLY BLOCKED</span>
            <strong>{promotionCounts.candidate}</strong>
            <p>
              Candidates remain untracked until every discovery requirement
              passes.
            </p>
          </div>
          <div>
            <span>TOP PROMOTION BLOCKERS</span>
            {topPromotionBlockers.length ? (
              topPromotionBlockers.map(([blocker, count]) => (
                <p key={blocker}>
                  <strong>{count}</strong> {humanize(blocker)}
                </p>
              ))
            ) : (
              <p>No immutable promotion evaluations yet.</p>
            )}
          </div>
        </div>
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="PROVIDER NETWORK"
          title="Live data sources"
          meta="observed from persisted runs"
        />
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
                  {provider.records.toLocaleString("sv-SE")} latest records
                </span>
                <span>
                  {provider.latestError ?? "No current provider error"}
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
            jobs={safeJobs}
            enabled={Boolean(process.env.DATA_OPERATIONS_OPERATOR_TOKEN)}
          />
        </section>
        <section className={styles.panel}>
          <PanelHeader
            eyebrow="COVERAGE"
            title="Provider diagnostics"
            meta="last 24 hours"
          />
          <div className={styles.coverageList}>
            <Coverage
              label="Provider observations"
              value={runs
                .filter((run) => run.started_at >= since)
                .reduce((sum, run) => sum + run.records_processed, 0)}
            />
            <Coverage
              label="Successful ingestion runs"
              value={
                runs.filter(
                  (run) =>
                    run.started_at >= since && run.status === "succeeded",
                ).length
              }
            />
            <Coverage
              label="Failed ingestion runs"
              value={
                runs.filter(
                  (run) => run.started_at >= since && run.status === "failed",
                ).length
              }
            />
            <Coverage
              label="Provider errors"
              value={
                (errorsResult.data ?? []).filter(
                  (error: any) => error.occurred_at >= since,
                ).length
              }
            />
          </div>
        </section>
      </section>
      <section className={styles.panel}>
        <PanelHeader
          eyebrow="SCHEDULER"
          title="Pipeline status"
          meta={`${jobs.length} registered jobs`}
        />
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
                  job.enabled ? schedulerStatus(job.status) : "UNAVAILABLE"
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
                {metricRecords(job.metrics).toLocaleString("sv-SE")}
              </strong>
              <div>
                <strong>{job.consecutive_failures} failures</strong>
                <small>
                  {job.last_error
                    ? truncate(job.last_error, 84)
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
          meta={`${jobRunsResult.data?.length ?? 0} loaded`}
        />
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
                    ? truncate(run.error, 110)
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
  jobs: Job[],
) {
  const matchingRuns = runs.filter((run) =>
    definition.matcher.test(run.provider),
  );
  const successful = matchingRuns.find(
    (run) => run.status === "succeeded" && run.finished_at,
  );
  const latest = matchingRuns[0];
  const fallbackJob = jobs.find((job) =>
    definition.fallbackJobs.some((jobType) => jobType === job.job_type),
  );
  const lastSuccessAt =
    successful?.finished_at ?? fallbackJob?.last_successful_run_at ?? null;
  return {
    name: definition.name,
    lastSuccessAt,
    records:
      successful?.records_processed ?? metricRecords(fallbackJob?.metrics),
    latestError:
      latest?.status === "failed"
        ? latest.error_message
        : (fallbackJob?.last_error ?? null),
    status: classifyOperationsStatus({
      lastSuccessAt,
      latestStatus: latest?.status ?? fallbackJob?.status,
      freshnessSeconds: definition.freshness,
    }),
  };
}

function metricRecords(metrics?: Record<string, unknown>) {
  const value =
    metrics?.records ?? metrics?.processed ?? metrics?.recordsProcessed ?? 0;
  return typeof value === "number" ? value : Number(value) || 0;
}
function schedulerStatus(status: string): OperationsStatus {
  return status === "HEALTHY"
    ? "LIVE"
    : status === "DEGRADED" || status === "FAILED"
      ? "DEGRADED"
      : "UNAVAILABLE";
}
function Status({ status }: { status: OperationsStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      {status}
    </span>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value.toLocaleString("sv-SE")}</strong>
    </article>
  );
}
function PromotionStat({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value.toLocaleString("sv-SE")}</strong>
    </article>
  );
}
function Coverage({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value.toLocaleString("sv-SE")}</strong>
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
function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
