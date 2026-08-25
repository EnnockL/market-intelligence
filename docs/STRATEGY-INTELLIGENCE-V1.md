# Strategy Intelligence v1

Strategy Intelligence ranks documented strategy evidence; it does not make trades.

## Flow

`strategy_definitions` is the immutable registry. Strategy Pattern Lab evaluates those
definitions against point-in-time candles. Strategy Research converts immutable evaluation
runs into immutable `strategy_performance_snapshots`. Strategy Selector ranks only
validation or out-of-sample snapshots available at the selection cutoff.

Train snapshots are never accepted as selection proof. A definition cannot be changed
without increasing its version, and identical datasets produce identical snapshot and
selector keys.

## Research metrics

V1 stores sample/setup/trade counts, win/loss rate, profit factor, expected and median R,
MFE, MAE, max/average drawdown and hold time. Fees and slippage remain `null` until the
underlying strategy trade ledger exposes those components separately. Missing values are
not converted to zero.

Segments cover asset, asset class, timeframe, weekday, exchange-local hour, session,
regime, volatility and liquidity. Unsupported liquidity context remains `UNKNOWN`.
Percentages and risk metrics stay null until the strategy's minimum sample size is met.

## Selector policy

The selector requires sufficient non-train history, positive expected value, profit factor
above one and available drawdown. Its deterministic fit score combines expected value,
profit factor, drawdown, sample size, session/regime fit and data quality. It may return
`NO_STRATEGY_ELIGIBLE`, which is the correct result when edge or evidence is insufficient.

V1 never executes orders, optimizes parameters, modifies strategies, promotes strategies
to production or invokes an LLM. Parameter search and true walk-forward optimization are
future versioned research tasks.
