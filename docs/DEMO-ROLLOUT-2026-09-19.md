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

Final rollout verification still needs the background-fix release Ready, a fresh
account capture and restoration of the original demo order switch. Existing
holdings exceed entry exposure/position limits; covered sales can reduce holdings,
but new buys are not granted a risk-limit exception. AI explanations remain paused
because their API key is not configured. No exchange orders have been sent.

Market data reference: [OKX API guide](https://www.okx.com/docs-v5/en/).
