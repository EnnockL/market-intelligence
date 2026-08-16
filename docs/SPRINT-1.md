# Sprint 1 — Data foundation

## Goal

Deliver a trustworthy data layer that tracks 100 Solana wallets and 100 stocks, records new events automatically, and exposes a searchable asset timeline. This sprint does not generate AI investment decisions or execute trades.

## Included

- Production-shaped dashboard shell and asset detail route
- Canonical stock/crypto asset model
- Solana wallet and transaction model with idempotency keys
- Time-series market prices
- Unified asset event timeline
- Versioned, deterministic wallet scoring with component audit trail
- Versioned signal and signal-component storage
- Supabase RLS baseline and health endpoint

## Acceptance criteria

- Replaying an ingestion batch creates no duplicate transactions or events.
- Every score can be reproduced from stored raw values, weights, and `scoring_version`.
- Opportunity and risk are stored independently.
- Asset timelines query newest-first by `asset_id` without a full table scan.
- Service-role credentials are never exposed to the browser.
- Unit tests cover score version, sample-size penalty, and empty history.
- Demo UI clearly identifies non-live data.

## Next implementation slices

1. Add provider adapters for stock quotes and Solana transactions behind stable interfaces.
2. Create a worker with checkpoints, retries, dead-letter recording, and provider rate limits.
3. Add repository functions and replace dashboard fixtures with server-side Supabase queries.
4. Add timeline search and tracked-universe administration.
5. Run a 24-hour ingestion soak test before beginning Smart Money clustering.

## Explicitly deferred

AI analysis, wallet convergence, news sentiment, paper trading, alerts, historical analogs, and any live order execution.

