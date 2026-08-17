# Fast Flow v1

Fast Flow consumes `wallet.buy_detected` through its own `fast-flow-v1` consumer delivery group. Delivery is at least once; opportunity and revision identities make retries idempotent.

## Detection policy

- At least three unique wallets.
- Every wallet must already be `verified` under the unchanged `wallet-verification-policy-v1` at the information cutoff.
- Buys must occur within 15 seconds.
- Wallet data quality must be at least 80%.

## Hard safety

A `fast_opportunity` requires all of the following point-in-time evidence:

- explicit pairwise wallet independence with at least 80% confidence;
- liquidity of at least USD 25,000 with at least 80% data quality;
- token-risk coverage of at least 80%;
- known mint and freeze authority components;
- no high-risk or confirmed-rug classification.

Missing evidence produces `enriching`. Related wallets, bot/MEV clusters, insufficient known liquidity, high risk, or confirmed rug evidence produce `rejected`. Absence of a relationship record is never interpreted as independence.

## Evidence and revisions

Every evaluation creates or reuses one deterministic `fast_flow` opportunity and appends an immutable `v0_fast_safety` revision. Event, wallet verification, relationship, liquidity, and token-risk records are registered as stable evidence references. All records must have been available at or before the revision cutoff.

## Current limitation

The relationship-observation schema is ready, but no clustering/funding provider populates it yet. Therefore real convergence will remain `enriching` until pairwise independence is supported by evidence. This is intentional and prevents correlated wallets from appearing as independent Smart Money.
