# Demo account reconciliation — 2026-09-19

Local implementation of a bounded spot-account pilot. Migration 0094 is applied
only to the isolated local Supabase test stack. Application production is not
migrated or deployed. No exchange orders, cancellations or transfers were sent.

## Implemented path

- An explicit `demo-account-baseline` worker command records an observed opening
  cash balance, external account UID, instrument, exact base/quote currencies and
  immutable provider evidence. Existing holdings are retained with observed market
  references and an explicit nonhistorical valuation policy. New local accounts
  are PAUSED; existing control flags are preserved. A baseline cannot be silently
  replaced, and unresolved/executed local order history prevents initialization.
- Account capture verifies the credential UID before importing fills. Read-only
  evidence covers instrument metadata, instrument-specific fee groups, bounded
  bill/order pagination, cash balances, unsupported algo orders and a fresh bid.
  It compares account identity, balances, pending orders and latest bill before
  completing the observation. API failures, retention gaps and budget limits stop
  the result. Provider pagination is not presented as an atomic exchange snapshot.
- Native balances are rebuilt from the baseline and bill balance changes and
  matched against fills per order/currency, fees and observed balances. Cash
  transfers in the configured quote currency are allowed; unknown movement types
  and noncash transfers are rejected. Unexplained frozen balances remain UNKNOWN.
- Historical FX owns post-baseline fill values; opening holdings use observed
  reference values, with PnL explicitly scoped to that boundary. Reconciled native
  cash valued in SEK owns current spending power. Funding and cash FX revaluation
  are not misreported as trading profits. The existing ECB ingestion now also
  retains EUR/SEK; USD, USDT, USDC and EUR are never interchangeable.
- Capture evidence, account observation and risk ledger publish in one transaction
  with an account-revision check. A failed capture publishes a new UNKNOWN result.
- New demo orders reserve the observed fee allowance. Final checks verify UID,
  configured instrument, LIMIT order and quantity × limit price × exact quote FX
  against the declared SEK notional, including cash for fees.
- The database serializes account claims and permits one in-flight local demo
  order. Every capture can authorize at most one order, including after that order
  becomes terminal. A fresh reconciliation is required before another order.
  The older authorization entry point is no longer callable by service_role.

## Actual configured account: read-only findings

The configured EEA OKX demo credentials returned HEALTHY, valid trade permission,
no withdrawal permission and an account UID. Existing nonzero currency balances:
BTC, XRP, EUR, USD, USDC and ETH. Account instrument discovery returned 51 spot
instruments. BTC-EUR exists; BTC-USD and BTC-USDT returned empty instrument lists.
The BTC-EUR instrument and its matching fee group were successfully read.

The user explicitly selected the existing account with all holdings. The reader
now completes authenticated GET-only evidence collection for all six currencies.
BTC, ETH, XRP and USDC are valued using their actual EUR market bids. USD is
valued using direct evidenced USD/SEK FX; it is never counted as spendable EUR.
The baseline retains every observed quantity and market reference. Ledger PnL is
explicitly scoped to the observed baseline, not historical acquisition cost.
The execution screen labels that distinction and now reads the actual daily PnL
and available cash fields instead of lifetime PnL and gross cash.

The account-wide risk ledger includes all holdings. Execution remains scoped to
one explicitly selected market, initially BTC-EUR. Unsupported manual trades,
non-quote funding movements, frozen passive balances or algorithmic orders
publish UNKNOWN rather than silently dropping account activity. This is not yet
an arbitrary cross-currency/multi-market execution engine.

## Preparation after deployment and account selection

Apply the complete reviewed backend migration chain including 0094, first in a
separate staging environment. Existing production migration gaps must be checked;
do not push all local migrations blindly.

With DEMO environment configuration and a verified supported instrument:

```powershell
npm run worker -- demo-account-baseline BTC-EUR --prepare-read-only
```

This command reads the exchange and writes the application's baseline. It does
not place orders or enable trading. Existing holdings are retained; it requires a
quiet, unreserved account boundary and complete valuations before a KNOWN risk
capture can be produced.
After initialization, regular account capture uses the new reconciliation path.

## Validation and remaining work

- Fresh and non-contiguous frontend-to-backend migration paths pass in PGlite.
- New SQL checks pass on real local PostgreSQL: roles, baseline safeguards,
  immutable binding, idempotent publishing, revision/account mismatch, rollback of
  evidence and observation on risk-write failure, and publication of UNKNOWN.
- Competing distinct demo claims were tested through independent PostgreSQL
  connections; only one succeeds. Terminal-order reuse of the same capture fails.
- Existing local Supabase/PostgREST suite: 56 tests in 27 files pass.
- Final unit suite: 943 passed across 118 files; 56 integration cases skipped in
  that run and then exercised separately against the local Supabase stack.
- Unit tests cover native reconciliation, provider payloads, current cash versus
  historical PnL, capture failures and final pre-dispatch identity/notional checks.
- TypeScript and the production build pass (see current session validation).

The strategy provenance/OOS producer and the separate risk-reducing exit policy
remain outside this account-reconciliation change. Generic SELL position/loss
gates have not been relaxed. This is not a complete autonomous trading release.
The current implementation reads at most 1,000 bills/orders per walk and supports
baselines less than 80 days old; durable incremental large-account processing is
future work. External manual changes can still occur after a read; conservative
freshness, quantity and account checks remain necessary.

Provider reference: [OKX official API guide](https://www.okx.com/docs-v5/en/),
account config/instruments/trade-fee/bills-archive/balance, pending orders and ticker.
Fee groups are used instead of deprecated top-level fee fields. The current account
and instrument findings above come from authenticated **GET-only** checks.

## Existing-account extension verification

- Authenticated GET-only read completed on the actual configured six-currency account.
- Six-currency service fixture includes all exposures, exact USD FX, actual USDC/EUR
  pricing, EUR-only buying power, reference-based opening inventory, and missing-mark failure.
- Opening-inventory SELL test verifies quantity reduction and baseline-relative loss.
- Unrecorded changes to passive holdings fail reconciliation.
- PostgreSQL and fresh PGlite checks verify multiasset baseline identity, quantity
  equality, valuation-policy guards and preservation of trading controls.
- 943 unit tests pass; production build and TypeScript pass after the extension.
- No production baseline or migration was written. No exchange orders were sent.
