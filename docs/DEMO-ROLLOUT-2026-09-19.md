# Demo rollout — 2026-09-19

User authorization: “ok kör på nu målet är att sätta igång allt”. Scope is the
existing OKX demo account, data collection, research and safe demo execution.
LIVE remains prohibited. Existing risk limits have not been increased.

## Verified production state and work performed

- Production already had contiguous database migrations 0001–0093 and an active
  scheduler. Mode DEMO / okx-demo, LIVE false, maximum order 100 SEK, maximum total
  exposure 200 SEK and maximum open positions 1 were observed before rollout.
- Refreshed ECB data: latest USD/SEK and EUR/SEK now 2026-09-18; previously only USD
  observations through 2026-08-17 were present.
- Applied reviewed migrations 0094–0097 in one production transaction, recording
  their exact SQL in the migration ledger. New demo orders were paused in that
  transaction. The original controls were retained in a local ignored operations
  file for deliberate restoration after verification.
- Registered the actual BTC-EUR demo baseline without selling/resetting holdings.
- Real account capture returned providerStatus KNOWN, riskStatus KNOWN, five
  non-EUR holdings, no unknown reasons and no reservations.

## Release additions

- Demo proposal mapping uses the bound account's exact EUR bid/ask, direct SEK FX,
  tick size, minimum size and lot size. Orders remain within the existing 100 SEK
  sizing policy. Unsupported accounts/assets, stale prices, wide spreads and
  unsuitable lot sizes block. Research/quality gates remain intact.
- Pipeline captures account evidence before proposal generation. Final submission
  also verifies venue quantity/price increments. EUR candles are not mislabeled
  as USD observations in the generic producer.
- Public OKX BTC-EUR candle ingestion retains confirmed bars and actual observation
  times, with descending pagination and duplicate-page rejection.
- New FX refresh and due prospective evaluation jobs are initially disabled in
  migration 0097; activate only after the matching worker release is Ready.
- Prospective runs are excluded from the legacy retrospective learning planner.

Validation before rollout: 988 unit tests, 58 real local Supabase integration tests,
97-migration frontend-to-backend upgrade checks, TypeScript and production build.

## Activation and production checks

- Release `67a7b8d` reached Vercel Ready on the production aliases. Database CI
  passed for that exact revision. FX and prospective-evaluation jobs are enabled;
  both have since completed through the production scheduler.
- Created native Bitcoin asset `48736961-9507-462d-82b4-a48dd39344d7` and the
  `okx-spot-btc-eur-5m` source. Initial two-day ingestion saved 575 confirmed bars.
- Registered separate research definition `6fec6fa7-7bbe-419b-94bd-83a4f2ed7425`
  and prospective plan `9917cf27-9194-4855-b858-082ca0c29199`, from
  2026-09-19 15:30 UTC through 2026-10-19 15:30 UTC. UTC all-day session, EMA 9/20
  and VWAP, 70 bps round-trip fee budget and 10 bps round-trip slippage budget.
  The engine deducts that combined budget once per completed simulated trade.
  This is a research hypothesis, not an approved strategy or an execution signal.
- Executed the full v2 demo pipeline against production: account and risk KNOWN,
  nine proposals evaluated and rejected, no eligible intents, no submitted orders,
  no reconciliation mismatches, LIVE false.
- Applied migration 0098 after local verification. Market-regime reads now use
  500-asset batches and count all pages, avoiding the API's 1000-row cap. Consumer
  registration only writes a bounded batch of missing deliveries each time.
- Production market-regime run succeeded for both scopes. Crypto correctly remains
  UNKNOWN due to low fresh coverage across the full catalog. Jackpot collector
  successfully claimed and processed 54 events with zero failures after the fix.
- Increased production SCHEDULER_BATCH_LIMIT from the default 1 to 5. This takes
  effect on the next release and addresses observed queue delays; leases and the
  existing 240-second invocation budget remain in force.

Validation of the background fix: dedicated >1000-asset pagination test, nine
real local Supabase integration checks (including bounded delivery and lease
recovery), 98-migration upgrade checks, TypeScript and production build passed.

## Final operating state

- Background release `7a0cdc4` reached Vercel Ready; its database CI succeeded.
- A new account capture returned KNOWN. Restored the original DEMO order switch
  with an audit revision, unchanged limits and LIVE false.
- Automatic production cron executed execution-pipeline-v2 successfully at
  15:22 UTC. Jackpot collector and historical candle jobs also succeeded through
  cron. Multiple jobs now run per invocation; the old one-job backlog is draining.
- Web health returned HTTP 200. A manual cron request using the local secret
  correctly received 401 (local credential differs); automatic production cron
  is verified independently by its successful scheduled job records.
- Follow-up wallet fix: the composite market provider now exposes its exact
  historical source. Wallet enrichment validates, queues, stores and rebuilds
  against that identity. Unexpected providers still fail. Liquidity history
  pagination follows the existing asset/time index, preserving deterministic
  complete reads and all read-budget guards.
- Real production wallet run after these fixes: 10/10 enriched, 269 cycles rebuilt,
  three wallets processed, zero errors or blocked wallets. Missing verified
  execution context is still explicit; enrichment alone does not approve wallets.
- Follow-up validation: 34 wallet/provider tests and TypeScript/build passed;
  previous complete suite was 989 tests plus separate database checks.

Existing holdings exceed entry exposure/position limits; covered sales can reduce
holdings, but new buys receive no risk-limit exception. No eligible proposal and
no exchange order existed at the last check. The BTC-EUR research period must
finish and meet validation requirements; it does not promise a profitable strategy
or automatic approval on its end date. AI explanations remain paused because
OPENAI_API_KEY is not configured. All six existing balances remain on the account.

Production: https://market-intelligence-ochre.vercel.app/execution


Market data reference: [OKX API guide](https://www.okx.com/docs-v5/en/).

## Final research isolation check

Migration 0099 scopes prospective regime history to the tested asset class and
includes that class in the frozen manifest hash. Crypto trades cannot inherit a
stock regime. Verified in the 99-migration upgrade and actual local PostgreSQL
SQL suite, then applied to production without changing execution controls.

Wallet release `79ae927` is Ready on production. All tested HTTP routes (health,
execution, strategy lab, data collection) return 200. Market-regime and jackpot
cron jobs have both recovered to HEALTHY; automatic v2 execution has succeeded
repeatedly. The pre-release wallet invocation failed before loading the new code;
the corrected provider and indexed query passed the real 10-transaction worker run.

Migration 0100 adds a covering event-stream index after a subsequent collector
poll still timed out under concurrent load. The measured production registration
query now uses an index-only scan and hash anti-join (about 1.5 seconds on its first
measured read); a real subsequent collector call succeeded. Seven actual local
consumer integration checks passed before applying the index. Execution controls
were unchanged. Transient failed scheduler runs remain visible and retry normally;
a successful direct worker check is not relabeled as a successful scheduled run.

## Observed completion checkpoint (15:32 UTC)

Release `b54ffe9` is Vercel Ready and database CI succeeded; production has
contiguous migrations 0001?0100. Automatic v2 execution completed again at 15:32
with DEMO enabled, LIVE false and no submitted orders. All existing balances are
retained. The planned prospective test has now begun collecting future evidence.

The first scheduled wallet run using the fix saved all 10 enrichments with zero
transaction failures and rebuilt 138 cycles. Two other wallet histories exceeded
the bounded-read budget, so the overall job deliberately reports PARTIAL/FAILED
and rotates for retry. Do not label these wallets verified or hide that status.
One baseline-forecast target also recorded a statement timeout during rollout and
is retrying. These are remaining background processing limitations, not an
unknown demo account or permission to trade. AI explanations remain paused for a
missing API key. No strategy has been promoted by this startup work.
