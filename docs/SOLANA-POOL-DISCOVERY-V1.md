# Solana Pool Discovery v1

Provider-neutral, bounded discovery of newly observed Solana pools. GeckoTerminal new pools is the primary source and DEX Screener token profiles is an independent fallback/discovery source.

## Truth guarantees

- `token.discovered` means first observation by this system, not token creation.
- `pool.created` is emitted only when the provider supplies a valid creation timestamp.
- Missing pool identity, liquidity, market cap, or timestamps remain `null`.
- Provider overlap is deduplicated deterministically by mint, pool, data quality, and provider name.
- Observation and event identities are stable, so retries do not create duplicates.
- Partial provider failure is persisted as a degraded provider error while healthy providers may continue.
- Discovery never creates trade proposals or orders.

## Flow

`PoolDiscoveryProvider -> pool_discovery_observations -> crypto_market_observations -> Event Envelope -> PostgreSQL Outbox -> Jackpot Collector`

The scheduler runs the bounded discovery job every two minutes. Downstream qualification policy and thresholds are unchanged.

