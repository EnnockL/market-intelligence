# Account State + Risk Ledger v1

This layer removes fabricated account risk inputs from execution. It stores immutable provider account observations and immutable deterministic SEK risk snapshots. Missing FX, fill valuation, fees, balances, or exposure returns `UNKNOWN` and must block execution.

Shadow mode has an explicit research allocation of SEK 1,000. It is labelled modelled shadow capital and is never presented as an exchange balance. OKX demo reads balance and positions using its demo-only authenticated adapter. Live execution remains forbidden by a PostgreSQL constraint.

Run `npm run worker -- account-state` for account-only collection or `npm run worker -- execution` to collect account state before reconciliation. Diagnostics are available at `/execution`.
