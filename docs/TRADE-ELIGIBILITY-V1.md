# Trade Eligibility v1

Trade Eligibility is the deterministic gate between research/policy output and Execution Infrastructure.

Every immutable proposal is evaluated requirement by requirement. A result is one of:

- `ELIGIBLE`: every requirement is known and passes.
- `REJECTED`: at least one known fact contradicts policy.
- `DATA_BLOCKED`: no requirement fails, but required information is `UNKNOWN`.

V1 checks Meta readiness, directional agreement, instrument mapping, price, SEK size, base quantity, stop, target, slippage, critical safety, liquidity, token risk, freshness and expiry. Future evidence is rejected and repeat evaluation under the same policy is idempotent.

Meta Agent cannot create orders directly. V1 deliberately does not turn even an `ELIGIBLE` proposal into an execution intent until provider-independent account state and daily-loss accounting are available. This prevents a fabricated zero-loss/exposure value from passing the final Safety Kernel.

Run with `npm run worker -- trade-eligibility`. Diagnostics are shown at `/execution`.
