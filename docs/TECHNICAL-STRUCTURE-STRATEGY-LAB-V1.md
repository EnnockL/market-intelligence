# Technical Structure, Market Time & Strategy Pattern Lab v1

This layer evaluates explicit trading rules over immutable point-in-time candles. It does not use an LLM to infer chart patterns and it never submits an order.

## Contracts

- `market_candles` is the canonical OHLCV input. A candle is usable only when both `closed_at <= T` and `available_at <= T`.
- `technical_structure_snapshots` stores deterministic EMA, VWAP, levels, session range, sweep, structure, and volatility output. Missing input remains `UNKNOWN`.
- `market_time_contexts` resolves exchange-local time with IANA timezones, including DST, and keeps unavailable earnings/macro context as `UNKNOWN`.
- `strategy_definitions` is immutable and versioned. Entry, exit, cost, stop, target, session, timeframe, and minimum sample rules live in its definition JSON.
- `strategy_evaluation_runs`, trades, and segment metrics are immutable and keyed by the strategy definition plus the exact ordered candle dataset.

## Reference strategy

`asia-ny-sweep-reversal` v1 records the completed New York session high/low, observes only later Asia-session candles, requires a close back inside the reference range after a sweep, places the stop beyond the sweep wick plus a configured buffer, and targets the opposite reference level.

The strategy is configuration supplied to the generic replay kernel. New strategy families extend the versioned setup contract; they must not bypass cutoff, evidence, cost, or sample-size policies.

V1 also includes `ema-vwap-momentum` v1: a 9/20 EMA crossover confirmed by session VWAP, with versioned fixed-R stop/target and costs. It uses the same candle, cutoff, trace, and evaluation contracts as the sweep strategy.

## Guarantees and current limits

- Same definition, cutoff, and candle IDs produce the same input hash and result.
- Future or late-available candles are excluded before any indicator or trade calculation.
- Stop wins candle ambiguity: when stop and target are both touched in one candle, the conservative result is a stop.
- Win rate, profit factor, expected value, and segment percentages remain null until their minimum sample size is met.
- Earnings windows, macro windows, volume profile, and retest confirmation remain `UNKNOWN` until concrete point-in-time providers/rules exist.
- V1 supplies the canonical candle schema and research kernel. Historical candle ingestion is the next provider task; no synthetic production candles are inserted by this migration.

## Opening Range Breakout v1

Two immutable reference definitions are available: `orb-retest-5m` and
`orb-retest-15m`. Both use the US regular-session clock in `America/New_York`,
including daylight-saving transitions.

The replay builds the opening high/low from closed candles, requires a close outside
the range, at least 1.5x opening-range baseline volume, point-in-time VWAP confirmation,
and a valid retest within six candles. Entry is the retest close, stop is beyond its wick
plus five basis points, and target is fixed at 2R. A breakout without a retest is a setup,
not a trade. Missing volume/VWAP data never becomes zero, and same-candle stop/target
ambiguity remains conservatively stop-first.

Results segment by weekday, session, regime, side, exchange-local entry hour, and
opening-range volatility. The worker selects definitions through `STRATEGY_ID` and the
asset through `STRATEGY_ASSET_SYMBOL`; defaults are `orb-retest-15m` and `AMD`.
