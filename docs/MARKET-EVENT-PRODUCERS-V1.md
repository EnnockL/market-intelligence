# Market Event Producers v1

Producers only turn point-in-time observations into deterministic facts. They do not score opportunities or make investment decisions.

## Contract

`market-event-producers-v1` emits versioned Event Envelopes through the PostgreSQL outbox. Price, volume and liquidity changes use a 300-second comparison window and `market-baseline-v1`. Missing or non-comparable baselines produce an immutable `NO_EVENT / INSUFFICIENT_HISTORY` evaluation; they never produce zero values.

- `token.created`: first stored observation of an asset.
- `pool.created`: first observed pool identity, or a transition from no pool to a pool.
- `market.liquidity_added` / `market.liquidity_removed`: at least 25% point-in-time change between comparable snapshots.
- `market.volume_accelerated`: at least 2x between comparable snapshots.
- `market.price_accelerated`: at least +20% between comparable snapshots.
- `market.new_wallet_inflow`: at least three distinct wallets' first observed buys within five minutes. Coverage describes only configured tracked-wallet observation coverage and is always classified `PARTIAL_COVERAGE` in v1.
- `holder.growth`: `UNAVAILABLE` until a real holder provider exists.

Every evaluation is append-only and records its cutoff, baseline identity/version, result, details, event identity and deterministic hash. Retries therefore reuse the same event/evaluation identities.

## Known limitations

The current market observation source exposes rolling 24-hour volume rather than true interval volume. The event records this source field honestly, but a future provider should supply interval buckets. Wallet inflow is visibility into the configured tracked set, not total-chain wallet coverage.
