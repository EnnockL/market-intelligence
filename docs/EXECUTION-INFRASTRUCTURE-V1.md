# Execution Infrastructure v1

Execution v1 is a safety boundary, not a trading strategy. It accepts immutable execution intents, evaluates every deterministic safety requirement, records append-only state transitions and reconciles local state with a provider.

## Hard guarantees

- Runtime modes are limited to `SHADOW` and `DEMO`.
- `live_execution_enabled` is constrained to `false` in PostgreSQL.
- Any critical `UNKNOWN` blocks an order.
- Spot only, leverage at most 1x, explicit stop and target required.
- Withdrawal permission must be explicitly false.
- Stable intent and client-order keys make retries idempotent.
- Historical intents, safety evaluations, order events, fills and reconciliation runs are immutable.
- Provider state is reconciled independently of local worker state.

## Current provider

`ShadowExecutionProvider` performs no network request and moves an accepted order to `ACKNOWLEDGED`. `OkxDemoExecutionProvider` uses the same contract, only accepts an allow-listed OKX host, always sends `x-simulated-trading: 1`, checks account permissions and requires explicit spot quantity. It never performs an implicit SEK-to-quote-currency conversion.

Demo mode requires both the database control and environment to say `DEMO`, plus `OKX_DEMO_ENABLED=true` and all three demo credentials. Any mismatch stops the worker.

## Deliberately excluded

- Live exchange execution
- Withdrawal capability
- Automatic creation of intents from Meta/Forecast output
- Leverage, margin and derivatives
- AI-controlled sizing, stops, targets or risk limits

Run diagnostics at `/execution`. Run the worker with `npm run worker -- execution` after migration `0055` is applied.
