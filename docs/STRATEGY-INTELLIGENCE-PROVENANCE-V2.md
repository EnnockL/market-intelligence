# Strategy Intelligence provenance v2

The current evaluation run schema stores an input hash and a trade ledger, not a
complete candle window/provider manifest tied to a prospectively frozen split.
Validation-window plans infer their windows from completed trades. An approved
`FROZEN` or `OUT_OF_SAMPLE` phase is consequently **not sufficient** to prove that
the complete evaluation dataset was held out before learning.

This bounded repair does not invent that evidence or introduce a new strategy.

- The worker no longer assigns `VALIDATION` to every evaluation.
- Exact, point-in-time validation links identify `LEARNING` inputs as `TRAIN`.
  Other existing runs become `EXPLORATION`, including runs carrying post-hoc
  validation/OOS labels. Observed phases remain recorded for inspection.
- Sufficient, complete exploration trade ledgers retain their descriptive metrics.
  Provenance failure means **not eligible for selection**, not “no research result.”
  Incomplete/truncated ledgers have null metrics and an explicit reason.
- Research/selector versions are bumped. Legacy records remain immutable and are
  excluded by selector v2; they are not rewritten as trustworthy OOS evidence.
- Publication `available_at` is the actual processing time. Historical input cutoff
  is retained separately; a replay cannot consume a later-published research result.
- Migration 0086 refuses v2 `VALIDATION`/`OUT_OF_SAMPLE` writes, missing provenance,
  and caller-provided `VERIFIED` claims. No current producer can generate verified
  selection proof; `NO_STRATEGY_ELIGIBLE` remains the expected safe result.

## Required separate work before enabling OOS selection

Persist an immutable, prospectively frozen contract covering hypothesis/definition
and protocol versions, complete learning/held-out time windows, asset/provider
universe, dataset/source identity, and real registration/publication times. Bind
evaluations to that contract and verify non-overlap and input integrity before a
new versioned producer can emit verified provenance. A trade-span-only window,
positive PnL, or phase label must never substitute for this evidence. Already-used
learning data must not be relabeled as held-out data.

No scheduler activation, backtest, production mutation, execution change or gate
relaxation is included. Synthetic unit fixtures exercise future ranking logic only;
the database explicitly rejects such unverifiable claims from the current producer.
