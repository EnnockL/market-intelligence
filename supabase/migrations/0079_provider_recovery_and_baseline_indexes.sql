-- A global point-in-time index is required by the bounded baseline cohort scan.
create index if not exists crypto_market_baseline_cutoff_idx
  on public.crypto_market_observations(observed_at desc, ingested_at desc);

-- The configured Finnhub subscription does not include forex candles. Keeping this
-- source active permanently consumes one of the three bounded ingestion slots.
update public.candle_sources
set enabled = false,
    status = 'PAUSED',
    last_error = 'PAUSED_UNSUPPORTED_ENTITLEMENT: Finnhub Forex subscription required',
    updated_at = now()
where source_key = 'finnhub-forex-xauusd-5m'
  and last_successful_sync is null;
