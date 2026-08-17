# Wallet Independence and Clustering v1

`wallet-independence-v1` is deterministic and point-in-time. It separates raw wallet count, relationship coverage, confirmed independent entities, and cluster-adjusted count. Cluster-adjusted count remains `null` whenever pair coverage is below 80%.

## Evidence rules

- A common wallet funder is supporting evidence, never automatic proof of common ownership.
- A known exchange, bridge, or program funder is stored as `shared_service` and does not support a cluster.
- Repeated synchronized behavior and shared counterparties are supporting observations, not standalone classifications.
- A related pair requires combined cluster-support confidence of at least 80.
- Absence of relationships only supports independence when both wallets have verified history and at least 80 data quality.
- Bot, MEV, and exchange risks remain `null` when no deterministic evidence exists.

## Point-in-time history

Relationship evidence, address classifications, cluster snapshots, and memberships are immutable. Every record has observed/available timestamps. Consumers must use records with `available_at <= information_cutoff_at`. Later evidence creates a new snapshot and cannot rewrite an older Fast Flow revision.

Run locally with:

```text
npm run worker -- wallet-clustering
```

The worker is bounded by `WALLET_CLUSTERING_MAX_WALLETS`. Fast Flow reads the latest complete snapshot available at its revision cutoff and stores raw count, relationship coverage, confirmed independent count, cluster-adjusted count, model, cutoff, and evidence references. `UNKNOWN` blocks promotion rather than being treated as safe.
