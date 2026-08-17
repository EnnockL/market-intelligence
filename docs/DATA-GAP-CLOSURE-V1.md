# Data Gap Closure v1

This worker enriches active Jackpot candidates without changing `jackpot-qualification-policy-v1` or inventing values.

Priority order is safety/risk, liquidity, verified-wallet quality, token-risk coverage, acceleration events, and token age. Existing point-in-time records are reused before external providers are called. New information creates an immutable `v3_risk_liquidity` candidate revision and an immutable gap evaluation.

`CLOSED` means the datapoint is known, not that it passes qualification. For example, known liquidity below the policy threshold becomes a qualification `FAIL`. Provider denial, missing history, partial wallet evaluation coverage, and absent baselines remain `UNKNOWN` or `PARTIAL`.

Run:

```bash
npm run worker -- data-gap-closure
npm run worker -- qualification
```

The current Birdeye subscription supplies liquidity but does not authorize the Token Security endpoint. Safety and token-risk coverage therefore correctly remain `UNKNOWN` until that endpoint is available or another verified risk provider is configured.
