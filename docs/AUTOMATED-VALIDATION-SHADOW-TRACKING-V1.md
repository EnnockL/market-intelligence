# Automated Validation Windows + Shadow Tracking v1

The scheduler now audits the next chronological, non-overlapping validation window for every registered strategy hypothesis. A `READY` window is submitted to the existing deterministic validation service; retries reuse the same validation result. It never relaxes validation gates, never consumes future evidence, and records `INSUFFICIENT_DATA` when no honest next window exists.

Shadow tracking records immutable five-minute observations for strategies in `DEMO_VALIDATION` or `APPROVED_SHADOW`. Global execution activity is factual. Strategy attribution remains `UNKNOWN` because the current opportunity-driven execution contract has no stable `strategy_definition_id`; v1 deliberately does not infer one.

This sprint creates no orders and enables no live execution.
