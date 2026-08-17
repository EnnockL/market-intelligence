# Jackpot Candidate Collector v1

The collector creates a research dataset, not trading advice. It consumes versioned outbox events, deduplicates by token, strategy and active one-hour window, and appends immutable point-in-time revisions. Missing wallet independence, market data or safety remains `UNKNOWN`.

Detection revisions keep raw probability/payoff features separate. Outcomes record fixed-horizon prices, maximum multiple, 2x–100x hit times, MFE and MAE; a target that was not observed remains `null`. Rejected and insufficient-data candidates are retained.

Run `npm run worker -- jackpot-collector` after ingestion and `npm run worker -- jackpot-outcomes` as market observations arrive. Neither worker can execute trades.
