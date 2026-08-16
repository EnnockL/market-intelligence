# Market Intelligence Engine — Master Plan

## Product principle

The system must demonstrate measurable value, not merely produce convincing narratives. Opportunity, risk, confidence, data quality, and realized performance remain separate metrics. AI may interpret evidence; deterministic code owns prices, returns, liquidity constraints, scoring inputs, and portfolio accounting.

## Core engines

### Intelligence

Stock Intelligence, Crypto Smart Money, evidence-backed AI research, deterministic signal scoring, risk analysis, and historical analogs.

### Simulation Engine

Simulation is a core product surface. A user can change starting capital, time range, strategy, allocation, and maximum position size. Each run stores immutable assumptions and compares the strategy with S&P 500, Nasdaq, Bitcoin, and cash.

Crypto execution must constrain position size by available liquidity and apply fees, volume-dependent slippage, entry delay, and exit delay. A signal that cannot support the requested order size is partially filled or rejected; the simulator must never invent infinite liquidity.

Required output includes final value, absolute and percentage return, trade count, win rate, largest win/loss, maximum drawdown, profit factor, equity curve, and a complete trade ledger.

### Historical Replay

Every run has an `information_cutoff_at`. At replay time `T`, queries may only use records whose source observation timestamp and ingestion timestamp were available at `T`. Later revisions, later-discovered events, and future candles are excluded. Provider payloads, scoring version, strategy version, and execution assumptions are retained for reproducibility.

### Paper Portfolio

Paper portfolios consume live signals through the same execution-cost model as simulations. They never hold wallet private keys and cannot route live orders. Their purpose is forward validation against immutable historical backtests.

## Delivery order

1. Data foundation, dashboard, canonical models, ingestion contracts, watchlists, and immutable signal storage.
2. Live market and Solana ingestion with checkpoints and data-quality monitoring.
3. Simulation kernel, benchmarks, realistic execution costs, and replay isolation tests.
4. Paper portfolios using the same accounting and fill model.
5. Crypto Smart Money and Stock Intelligence.
6. Provider-neutral AI research and Bull/Bear/Risk/Evidence agents.
7. Historical analogs, alerting, evaluation, and closed beta.

## Non-negotiable validation

- No use of data newer than the replay clock.
- No score without persisted components and a scoring version.
- No simulated fill beyond configured liquidity participation.
- Corporate actions, delistings, token migrations, missing candles, and fees have explicit handling.
- Backtest results are compared with benchmarks over identical dates and currency assumptions.
- Execution remains paper-only until a separate security and compliance milestone is approved.

