# Historical Candle Ingestion v1

The candle pipeline supplies immutable point-in-time OHLCV data to Technical Structure and Strategy Pattern Lab.

## Providers

- Finnhub `stock/candle` and `forex/candle`: AAPL, NVDA, AMD, TSLA, MSFT and `OANDA:XAU_USD`. These candle endpoints require Finnhub Premium entitlement. A missing entitlement is stored as a provider failure; no substitute candle is created.
- GeckoTerminal public OHLCV: Solana pools configured in `candle_sources` with a verified pool address and explicit base/quote token side.

Provider selection is isolated behind `HistoricalCandleProvider`, so another vendor can replace either adapter without changing strategy contracts.

## Point-in-time policy

`closed_at` is when the candle becomes complete. `available_at` is the earliest bounded time the completed market observation could be used. `observed_at` records when our provider call retrieved it. The invariant is:

`closed_at <= available_at <= observed_at`

Incomplete candles, future candles, malformed OHLC, and unsupported timeframes are rejected. Historical backfill never makes a candle available before it closed.

## Operations

Run `npm run candles:sync` locally. Vercel Scheduler runs `CANDLE_INGESTION` every five minutes after Pro cron is enabled. `candle_sources` stores cursor, last successful sync, failures, and health. Fetches and pages are bounded; candle keys make retries idempotent.

The initial Finnhub sources backfill 30 days of 5-minute stock candles and 90 days of XAUUSD. Until the subscription permits these endpoints, Strategy Lab correctly remains `INSUFFICIENT_DATA`.
