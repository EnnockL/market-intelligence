create table public.candle_sources(
  id uuid primary key default gen_random_uuid(), source_key text not null unique, asset_id uuid not null references public.assets(id), provider text not null,
  instrument_kind text not null check(instrument_kind in('STOCK','FOREX','CRYPTO_POOL')), provider_symbol text not null, timeframe text not null,
  token_side text check(token_side in('base','quote')), enabled boolean not null default true, backfill_starts_at timestamptz not null,
  cursor text, last_successful_sync timestamptz, last_error text, status text not null default 'PENDING' check(status in('PENDING','SYNCING','HEALTHY','DEGRADED','FAILED','PAUSED')),
  consecutive_failures integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(asset_id,provider,timeframe)
);
create index candle_sources_due_idx on public.candle_sources(enabled,status,last_successful_sync);
alter table public.candle_sources enable row level security;
create policy "public read candle sources" on public.candle_sources for select using(true);
grant select on public.candle_sources to anon,authenticated; grant all on public.candle_sources to service_role;

insert into public.assets(kind,symbol,name,external_id,metadata) values('forex','XAUUSD','Gold / US Dollar','OANDA:XAU_USD','{"exchangeTimezone":"America/New_York"}') on conflict(kind,symbol) do nothing;
insert into public.candle_sources(source_key,asset_id,provider,instrument_kind,provider_symbol,timeframe,backfill_starts_at)
select 'finnhub-stock-'||lower(a.symbol)||'-5m',a.id,'finnhub-candles','STOCK',a.symbol,'5m',now()-interval '30 days' from public.assets a where a.kind='stock' and a.symbol in('AAPL','NVDA','AMD','TSLA','MSFT') on conflict(source_key) do nothing;
insert into public.candle_sources(source_key,asset_id,provider,instrument_kind,provider_symbol,timeframe,backfill_starts_at)
select 'finnhub-forex-xauusd-5m',a.id,'finnhub-candles','FOREX','OANDA:XAU_USD','5m',now()-interval '90 days' from public.assets a where a.kind='forex' and a.symbol='XAUUSD' on conflict(source_key) do nothing;

alter table public.scheduled_jobs drop constraint if exists scheduled_jobs_job_type_check;
alter table public.scheduled_jobs add constraint scheduled_jobs_job_type_check check(job_type in(
  'CANDLE_INGESTION','STOCK_INGESTION','WALLET_INGESTION','WALLET_DISCOVERY','CRYPTO_MARKET','MARKET_EVENTS','FAST_FLOW','JACKPOT_COLLECTOR',
  'BASELINE_FORECAST','FORECAST_OUTCOME','FORECAST_PERFORMANCE','NEWS_INGESTION','CATALYST_CLASSIFICATION','SPECIALIST_AGENTS','CONSENSUS','AGENT_PERFORMANCE','MARKET_REGIME','META_AGENT','META_READINESS'
));
insert into public.scheduled_jobs(job_key,job_type,scheduler_version,interval_seconds,lease_seconds,status,next_run_at,rate_limit_budget,priority)
values('historical-candles-5m','CANDLE_INGESTION','forecast-scheduler-v1.4',300,240,'HEALTHY',now(),'{"sourcesPerRun":3,"pagesPerSource":3}',4)
on conflict(job_key) do update set job_type=excluded.job_type,interval_seconds=excluded.interval_seconds,lease_seconds=excluded.lease_seconds,rate_limit_budget=excluded.rate_limit_budget,priority=excluded.priority,updated_at=now();
