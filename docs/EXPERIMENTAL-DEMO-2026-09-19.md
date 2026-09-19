# Experimental BTC-EUR demo pilot - 2026-09-19

The user explicitly selected experimental demo trading on the existing account,
with at most SEK 100 per order and SEK 200 of new exposure. This is an unvalidated
long-only pilot. It does not change research/runtime approvals or the frozen
September 19-October 19 prospective evaluation.

Implementation:
- Separate private trial configuration, immutable decisions and budget snapshots.
- A virtual SEK 200 opening cash allocation with zero opening inventory. Only
  verified provider fills linked to this trial change its inventory or PnL.
- Whole-account reconciliation remains mandatory; available cash and sell quantity
  are capped by both ledgers. Existing BTC/XRP/EUR/USD/USDC/ETH remain accounted for.
- BUY requires completed contiguous OKX BTC-EUR five-minute bars, EMA9 above EMA20,
  and close above the UTC-session VWAP computed from up to 288 recent bars.
  Bars must be no more than 10 minutes old. This trend rule is experimental; it
  is not an approval or an OOS result for the referenced research definition.
- Fresh venue quotes, sizes, fees and cash determine the actual LIMIT quantity.
  The existing 15-second final market/account checks and 50-bps spread/slippage
  bounds still apply. At most one sellable test position is opened at a time;
  residual below-minimum-size dust stays valued against the budget.
- Exit on bearish EMA trend, 5% decline, 10% gain, 30-minute hold, or pilot expiry.
  Exits execute on scheduler runs, not exchange-native protective orders. Prices
  and exact exit timing are not guaranteed. Open trial limit orders are cancelled
  after 60 seconds when next inspected; fills are reconciled before a new order.
- New entries stop after a seven-day pilot window; subsequent runs may exit the
  trial inventory. Global kill/new-orders switches still stop all submissions.
- Final authorization additionally binds the trial/action/account/snapshot and
  checks the trial budget under the existing serialized account lock. No trial
  can use a validated strategy attribution or submit outside DEMO/okx-demo.
- Generic execution still uses whole-account limits. Its gates were not relaxed.
- Pipeline v3 adds the trial step after the existing execution/reconciliation.
- Client order IDs now use 32 alphanumeric characters, as required by the
  [OKX order API](https://www.okx.com/docs-v5/en/#order-book-trading-trade-post-place-order).

Validation: 1,006 unit tests; 102-migration historical-upgrade and real PostgreSQL
SQL guards including private roles, old-inventory protection, budget, fee buffer,
expiry, wrong-source binding, kill switch and duplicate claims; production build.
No trial is enabled by migration 0102. Production activation and observed outcome
are recorded below after deployment.

Production activation:
- Migration 0102 is applied, and code c69d732 deployed successfully. The database
  deployment workflow passed. 60 local Supabase integration checks passed (the
  pipeline lease expectation was updated to 180 seconds and rerun).
- Trial 4e604e23-93ff-4ba5-b129-53662c8b0747 is enabled on okx-demo-primary from
  2026-09-19 18:39:03.598 UTC until 2026-09-26 18:39:03.598 UTC.
- Initial actual account capture and separate allocation are KNOWN: SEK 200 cash,
  zero trial exposure/inventory. Existing account holdings remain separate.
- The initial run correctly rejected stale bars. The pilot now directly refreshes
  up to 24 hours of confirmed BTC-EUR bars (three bounded pages) before signal
  evaluation, so it does not depend on the shared multi-source refresh queue.
- After that refresh, the production-data run returned WAITING_FOR_BULLISH_SETUP:
  fresh data is usable, but the current EMA trend does not support a long entry.
  No artificial order or validation approval was created to manufacture activity.
