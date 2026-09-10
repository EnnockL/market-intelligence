# Backend recovery pass — 2026-09-07

Scope: continue backend work after the frontend release at `52262e9`. Earlier
uncommitted backend work was preserved. This pass did not deploy, apply remote
migrations, call trading/data providers, start production jobs, change trading
mode or risk limits, or create orders. Local fixtures are not production evidence.

## Implemented in this pass

- Wallet PnL/evidence workers fail visibly on operational errors and retain
  successfully persisted partial record counts. A failed status write propagates
  its error. Successful explicit no-data responses are counted separately.
- Authorization, schema and transport exceptions no longer create permanent
  UNKNOWN enrichment records. A malformed normalized historical price is rejected
  before persistence. This does **not** rewrite old error-derived enrichments.
- Migration `0093` gives the queue and repository one point-in-time liquidity
  predicate: effective time in `[trade time - 2 minutes, trade time]` and
  information availability no later than the trade. Later-known/future points do
  not count as coverage. Zero observed liquidity remains evidence, not approval.
- Historical wallet windows rotate by persisted attempts, with a five-minute
  cooldown and an atomic per-asset claim. Empty historical windows cannot consume
  every attempt ahead of later transactions. Covered-window fallback preserves
  current token-risk refresh. This is a live work queue using database time, not a
  historical replay queue; provider information availability is never backdated.
- Strategy-validation automation explicitly maps database `window_end` to domain
  `windowEnd`. Validation ends at the maximum exit timestamp, retaining trades
  opened earlier but closed later. Freeze, overlap, concentration and OOS gates
  are unchanged; old immutable results are not overwritten.
- Migration `0092` persists read-only order observations and their audit events in
  one transaction. Same-status partial-fill quantity increases are recorded.
  Revision checks prevent an in-flight read overwriting a changed order. Replays
  are idempotent; regressive quantities, terminal-state reopening, conflicting
  identities, ambiguous corrections and missing provider orders stay blocked.
  These observations do not fabricate `execution_fills`. Incomplete reconciliation
  stops the worker before capture/submission instead of continuing with stale state.

## Verification

- Full local unit/service suite: 907 passed, 56 skipped. The skipped integration
  tests require a separate Supabase test project; application credentials were
  not substituted for test credentials.
- TypeScript: passed.
- Memory-only PostgreSQL harness: all 93 migrations apply and the regression
  checks pass, both from scratch and in the non-contiguous frontend upgrade order
  (`0001`–`0081`, `0083`, `0091`, then the remaining backend migrations).
- Upgrade checks assert that trading mode, order switches, risk limits, account
  status and enabled jobs remain unchanged.
- SQL checks include rollback on audit-write failure, private RPC permissions,
  quantity/revision guards, exact retry behavior, point-in-time boundary tests,
  window fairness and cooldown. PGlite serializes its connection: these tests are
  **not** a real multi-connection race/load or Supabase PostgREST test.
- Production build: passed in an isolated source copy containing no real `.env`
  files (only the tracked `.env.example`). Application routes compiled;
  no production/provider credentials were copied into the build workspace.

Reproduce the SQL checks without app credentials:

```text
node scripts/check-data-value-migrations.mjs <pglite-package-directory>
node scripts/check-data-value-migrations.mjs <pglite-package-directory> --upgrade-from-frontend-release
```

## Release boundary and remaining work

No release of this backend work has been made. No separate Supabase staging
credentials are configured; the local Docker daemon was unavailable during this
pass. Before a backend rollout, use a separate test database to verify real
PostgREST roles and concurrent connections, then review the exact migration list
and deploy a coherent source snapshot. Because backend versions precede already
applied `0091`, a normal latest-only migration push is insufficient. Review an
explicit include-all dry run; do not mark missing versions applied as a shortcut.

Next bounded work:

1. Bind imported execution evidence to a verified external account identity, then
   reconcile funding/balances, complete pending-order inventory and current marks.
   Current UNKNOWN gates remain necessary; read-only fill history alone is not a
   complete account ledger. Different-order reservation races are still unresolved.
2. Publish wallet PnL rebuilds as atomic, versioned generations. The legacy curve
   replacement path remains non-atomic; this pass does not certify wallet PnL as
   live-trading-ready or rewrite already persisted provider-error records.
3. Define a prospective frozen multi-asset validation dataset. A profitable
   single-asset run cannot satisfy the current portfolio concentration gate;
   lowering the gate or labeling hindsight-selected runs OOS is not a solution.

Baseline backfill per-target backoff, data-gap evidence freshness policy, risk-
reducing exits, and complete provider-order coverage also remain separate work.
More observations or passing software tests do not establish a profitable edge.
