alter table public.wallet_trade_cycles
  add column wallet_score_at_entry smallint check(wallet_score_at_entry between 0 and 100),
  add column scoring_version_at_entry text,
  add column token_risk_score_at_entry smallint check(token_risk_score_at_entry between 0 and 100),
  add column entry_context jsonb not null default '{}';

comment on column public.wallet_trade_cycles.wallet_score_at_entry is
  'Wallet score known at first entry, never a later score backfilled into history.';
comment on column public.wallet_trade_cycles.entry_context is
  'Point-in-time liquidity, market cap, rules and model versions known at entry.';
