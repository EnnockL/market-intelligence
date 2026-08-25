create index if not exists crypto_market_latest_regime_idx
  on public.crypto_market_observations(asset_id,observed_at desc)
  include(id,provider,price_usd,ingested_at)
  where price_usd is not null;

create index if not exists crypto_market_provider_regime_idx
  on public.crypto_market_observations(asset_id,provider,observed_at desc)
  include(id,price_usd,ingested_at)
  where price_usd is not null;

create index if not exists market_prices_provider_time_idx
  on public.market_prices(asset_id,provider,captured_at desc)
  include(close,source_event_id,interval);
