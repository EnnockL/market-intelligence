# Qualification Diagnostics v1

`jackpot-qualification-policy-v2` evaluates every immutable Jackpot candidate revision independently. It does not change candidate state and does not recommend threshold changes. V1 remains stored for replay; V2 preserves every threshold but only applies first-buy lateness to actual `wallet.buy_detected` evidence. Provider delay on `pool.created` is tracked separately and cannot masquerade as wallet lateness.

Each requirement is persisted as `PASS`, `FAIL`, `UNKNOWN`, or `NOT_APPLICABLE`, with observed and required values, evidence references, source, quality, and the revision information cutoff. Evidence whose `available_at` is later than that cutoff is rejected.

Decision semantics:

- `QUALIFIED / PASS`: no explicit failures and no policy-blocking unknowns.
- `REJECTED / TRUE_NEGATIVE`: at least one observed value explicitly fails policy.
- `WATCH / DATA_BLOCKED`: no explicit failure, but a critical requirement is unknown.

Low relationship or token-risk coverage is a data gap (`UNKNOWN`), not evidence that the asset itself failed. Holder growth is `NOT_APPLICABLE` while no holder provider is available. Thresholds live only in the versioned qualification policy; workers and UI must not duplicate them.

Run after candidate/event enrichment:

```bash
npm run worker -- qualification
```

Migration `0022_qualification_diagnostics_v1.sql` adds immutable policies, evaluations, requirement rows, and aggregate snapshots. Rerunning the same candidate revision under the same policy is idempotent.

Known limitation: current candidate revisions do not yet carry complete verified-wallet counts, token age, holder coverage, or risk-component coverage for every asset. Those remain visible as `UNKNOWN`; diagnostics intentionally does not infer them.
