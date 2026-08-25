# Historical FX Provider v1

Provider-neutral, point-in-time USD/SEK observations derived from ECB daily EUR reference-rate legs. `USD/SEK = SEK/EUR ÷ USD/EUR`. Every observation stores effective, observed and available timestamps, source identity and quality and is immutable.

Lookup requires both `effective_at <= execution timestamp` and `available_at <= information cutoff`. Missing data returns `UNKNOWN / NO_POINT_IN_TIME_FX`; there is no fixed-rate fallback.

The legacy Paper Portfolio model `paper-engine-v1` and its fixed `USD_SEK_FIXED_10_5` snapshots remain unchanged and reproducible. New point-in-time conversion uses policy `point-in-time-fx-v1`. Rebuilding paper portfolios onto this policy is intentionally a new model/version, never an update of legacy fills or snapshots.

ECB rates are daily information reference rates rather than executable intraday quotes. Weekends may use the last earlier observation only when it was already available at the requested cutoff.
