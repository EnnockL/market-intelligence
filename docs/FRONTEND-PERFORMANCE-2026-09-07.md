# Frontend performance and result integrity — 2026-09-07

Local implementation only. No commit, push, deployment, production migration,
provider purchase, scheduler run, backtest submission or trading action was made
as part of this frontend work. Existing local backend/security changes were kept.

## What changed

- A shared `loading.tsx` enables partial prefetch/navigation feedback for dynamic
  routes. The sidebar remains interactive while page data loads.
- Market Radar now streams independent panels under Suspense instead of waiting
  for all seven loaders. Radar status/pulse/signals share one request-local read;
  there is no cross-user cache of live observations.
- Loading/error/empty/incomplete states are distinct. Rejected reads and resolved
  degraded reads do not become empty success messages or fabricated zero balances.
  Common short states share a minimum-height region; long lists can still grow.
- Sidebar pending feedback follows Next's actual link state. Mobile navigation
  has focus trapping, Escape, closed-drawer inertness and desktop/mobile reset.
  General clipping was replaced with targeted wrapping and local list scrolling.
- Stock quotes use latest-row reads per asset, not unbounded history or a global
  cap that can starve less frequently updated stocks. Fast Flow/Jackpot fetch at
  most ten exact parent/current-revision pairs, not full revision histories.
- The dashboard uses a paper summary rather than historical orders. Full paper
  views request at most 20 recent orders and one performance snapshot per policy.
- Strategy Lab keeps controlled dates/selections in its URL. Returned run IDs,
  including reused older runs, select the capital/curve/ledger together. No global
  latest run silently replaces a missing, pending or failed selection.
- Only the selected lab run loads trade rows (up to 1,000). Incomplete or invalid
  trade rows block the capital projection; 0 trades is not profitable evidence.
  Lost action responses are not automatically retried. Operator guards remain.

## Measurement method and limits

`node scripts/measure-page-response.mjs http://localhost:3107/ 3`

Read-only GETs against a local **production build** using the configured backing
data. Identity encoding, three sequential samples, no browser. The first sample
includes a cold route. Port 3000 belongs to a different project and was untouched.

| Local root route | First sample | Warm sample 1 | Warm sample 2 |
| --- | ---: | ---: | ---: |
| Before: first response chunk | 1,756 ms | 956 ms | 963 ms |
| Before: complete response | 1,757 ms | 956 ms | 963 ms |
| Initial streaming build: first response chunk | 198 ms | 25 ms | 19 ms |
| Initial streaming build: complete response | 1,817 ms | 637 ms | 648 ms |

These initial after-samples were taken before the final paper snapshot consistency
fix. They demonstrate early streaming, not production latency or reliable end-to-end
performance. Response bytes grew from about 100 KB to 122 KB due to streamed
fallbacks/markup. This is not a measured bundle-size reduction. Database payload
reductions are covered by bounded-query tests, not inferred from HTML bytes.

The Browser skill was attempted; setup had no available browser (`browsers.list`
returned an empty list). No visual inspection, browser FCP/LCP/CLS/INP, device
throttling or mobile tap/scroll verification was possible. SSR, keyboard helpers
and CSS contract tests do **not** replace that remaining visual QA.

## Scope kept unchanged

No Socket.IO, Zustand, Redux, chart library, Rust/Go rewrite or binary protocol
was introduced. No global auto-refresh resets forms. Targeted subscriptions and
refresh cadence remain a separate measured phase. Live execution and qualification
thresholds were not enabled or relaxed.

## Deployment and remaining checks

- This work remains local with the earlier backend hardening changes.
- The paper financial summary requires migration `0091_frontend_paper_snapshot.sql`;
  an unavailable RPC must display unavailable, never fall back to inconsistent
  independently fetched cash and positions.
- Existing paper BUY/SELL writers perform multiple database writes. A coherent
  read removes the new cross-request regression but is not proof those writes
  are atomic. Paper values remain observed simulation state, not a verified live
  account ledger. Making those writers transactional is separate backend work.
- After migration/deployment: repeat production measurements, inspect slow
  network navigation and widths 320/379/768/1440, test January date entry plus
  refresh/back navigation, and compare the selected run ID across all results.

## Final local verification

- TypeScript: passed (`npm run typecheck`).
- Full Vitest suite: **806 passed, 56 skipped** (107 passed test files, 27 skipped).
  Skipped integration tests require a separate explicitly configured test database;
  production credentials were not loaded into test workers.
- All **91 migrations** applied to disposable in-memory PostgreSQL. Prior backend
  regression checks and new paper snapshot checks passed: role isolation, private
  portfolio exclusion, more than 1,000 complete positions, hard read caps, NULL/NaN
  valuation rejection and exact closed PnL.
- Production build: passed. No dependency or lockfile changes.
- `git diff --check`: passed. Existing unrelated/local backend changes preserved.
- The temporary baseline/preview server was stopped; the unrelated process on
  port 3000 was not modified.

The first streaming comparison above is intentionally left labelled as an initial
measurement. Migration 0091 has not been applied to the configured remote database,
so timing the final paper fallback would not be a like-for-like full-content test.
