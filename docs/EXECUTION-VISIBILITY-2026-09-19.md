# Execution visibility correction

The execution page now reads spendable quote currency from the exact demo capture
referenced by the displayed risk snapshot, scoped to its account. It no longer
labels unpopulated legacy USD columns as unknown spendable capital. Missing or
failed captures remain unknown. USD total equity is explicitly not reported.

Ordinary candidate/eligibility totals are separate from the latest 12 rows. The
page explains producer gates, subsequent eligibility, final account checks, and
the existing USDT-producer versus BTC-EUR account binding mismatch.

The experimental pilot is explicitly separate from ordinary proposal/eligibility
and validated strategy attribution. Its latest ten orders have an evidence-linked
trace: candle close/availability, decision, intent, order events, provider IDs,
individual fills with fees/provenance, and entry/exit reason. Lists are bounded
and report truncation/errors. Limit price is not represented as modeled fill;
provider creation time, modeled fill and ordinary eligibility are not fabricated.
Realized PnL remains trial-wide, not an invented per-order attribution.

This is a read-only presentation change. No risk policy, trial configuration,
order generation or trading activation changed. No database migration required.

Validation: production build and 17 targeted tests passed, including capture and
account binding, quote currency selection, and missing/failed capture handling.
