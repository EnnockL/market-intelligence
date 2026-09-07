# Isolated frontend release — 2026-09-07

Release source: `a52ebff`, based on production/main `0c254c9`.
The earlier implementation report records the full local workspace; it is not
the test/deployment record for this narrower release.

## Scope

Frontend streaming, bounded read models, navigation/mobile CSS, exact selected
lab results, guarded operator actions, and public read/error-state correctness.
No dependency changes. Existing services, workers, repositories, cron handler,
execution configuration and qualification thresholds are unchanged.

Only migrations `0081_private_execution_access`, `0083_public_read_truth`, and
`0091_frontend_paper_snapshot` accompany this release. Production was confirmed
through 0080. A dry run against the isolated checkout listed exactly those three
migrations, with no seeds, roles or other pending backend migration.

The remaining local backend work (0082, 0084–0090 and its code) is deferred.
Do not run an unreviewed migration push from that dirty workspace. Future rollout
must inspect the migration history and explicitly handle these older missing
versions; never mark unapplied migrations as applied to conceal the gap.

## Exact release verification

A clean detached checkout of a52ebff, with its own `npm ci` and no application
credentials loaded into tests, passed:

- TypeScript and Next.js 16.3.1 production build.
- 542 tests; 57 isolated-database integration tests skipped (92 test files passed).
- Disposable PostgreSQL: 0001–0080 plus only 0081, 0083 and 0091.
  Private roles, service-role reads, all three stable/invoker RPCs, accurate
  aggregate windows, paper valuation completeness and unchanged execution/job
  settings are checked by `scripts/check-frontend-release.mjs`.

Browser setup returned no available browser. Visual mobile, touch/scroll,
real navigation and Web Vitals checks remain outstanding. HTTP GET smoke tests
do not replace them. The local performance report has separate earlier numbers.

Production pre-release root GET samples (identity encoding, same client):
first chunk 9,330 / 8,714 / 8,795 ms; complete 9,376 / 8,762 / 8,888 ms.
These three samples are observations, not a percentile or performance guarantee.

## Operator access

A new cryptographically random operator token is stored only in ignored
`.env.local` as `DATA_OPERATIONS_OPERATOR_TOKEN`, and as a Vercel Production
Secret. Its value is not committed or displayed in reports. Do not reuse an
exchange, provider or scheduler secret for this purpose.

Use `/operator` to sign in with that token. Sessions last two hours and use a
signed HttpOnly, Secure-production, SameSite=Strict cookie. Signing in does not
enable live trading. Public research remains readable without signing in.

## Publication checks

Deploy only the exact Git release, never the dirty local backend workspace.
Before completion confirm the selected database versions, successful GitHub
migration workflow, Vercel Ready status for the pushed commit, public read routes,
anonymous execution redirect and read-only RPC/permission checks. Do not trigger
cron, submit backtests or place orders as an HTTP smoke test. Check whether old
deployment URLs are protected before claiming they inherit the new web guards.
