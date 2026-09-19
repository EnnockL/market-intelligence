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

## Remaining operational work at this checkpoint

Deploy the exact committed code, activate data jobs, configure the BTC-EUR source
and a prospective strategy plan, inspect the two production statement-timeout jobs
(market-regime and jackpot collector), verify pipeline diagnostics and restore the
demo order switch only after checks. Existing holdings exceed the entry exposure/
position limits; covered sales can reduce holdings, but new buys are not granted
an automatic risk-limit exception. No exchange orders have been sent.

Market data reference: [OKX API guide](https://www.okx.com/docs-v5/en/), public
history-candles endpoint and account instrument metadata. Actual EUR metadata,
account capture and public candle responses were also checked directly.
