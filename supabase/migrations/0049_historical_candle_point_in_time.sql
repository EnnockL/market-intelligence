alter table public.market_candles drop constraint if exists market_candles_check1;
alter table public.market_candles add constraint market_candles_point_in_time_check check(closed_at<=available_at and available_at<=observed_at);
alter type public.asset_kind add value if not exists 'forex';
