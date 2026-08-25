# Performance Agent v1

Deterministic, immutable measurement of paper-policy behavior and economic outcomes. It calculates the funnel `Observed → Evaluated → Eligible → Ordered → Filled → Closed`, reject/blocker distributions, coverage, fees, slippage and portfolio metrics.

Win rate, profit factor, expected value, holding time and drawdown return `INSUFFICIENT_DATA` when their required samples do not exist. They are never represented as zero. Input hashes make identical policy/candidate/accounting state idempotent and reproducible.

V1 contains no LLM. Snapshots explicitly carry the fixed USD/SEK limitation until historical FX is implemented.
