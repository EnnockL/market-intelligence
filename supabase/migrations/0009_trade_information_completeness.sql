alter table public.wallet_trade_cycles
  add column information_completeness smallint not null default 0
  check(information_completeness between 0 and 100);

comment on column public.wallet_trade_cycles.information_completeness is
  'Coverage for point-in-time liquidity, market cap, priority fees and other execution context.';
