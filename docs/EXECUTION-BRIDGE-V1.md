# Execution Bridge v1

The bridge is the only path from an `ELIGIBLE` proposal to an execution intent. It requires a non-expired proposal, a current immutable account observation, a known point-in-time risk ledger snapshot, sufficient cash, exposure and daily-loss headroom, healthy provider permissions, spot-only mapping, no leverage, stop, target, liquidity and token-risk safety.

Every attempt is immutable and idempotent. `UNKNOWN`, stale account state, insufficient cash, kill switch, provider failure, or any critical safety failure creates no intent. The bridge supports only SHADOW and OKX DEMO; PostgreSQL still forbids live execution.

Run `account-state`, then `trade-eligibility`, then `execution-bridge`, and finally `execution`.
