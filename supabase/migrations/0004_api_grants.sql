grant usage on schema public to anon, authenticated, service_role;

grant select on public.assets, public.market_prices, public.asset_events, public.signals, public.signal_components
to anon, authenticated;

grant select, insert, update, delete on public.watchlists, public.watchlist_items
to authenticated;

grant select, insert on public.simulation_runs to authenticated;
grant select on public.simulation_trades, public.simulation_equity_points, public.simulation_results,
  public.simulation_benchmarks, public.replay_checkpoints to authenticated;
grant select, insert, update, delete on public.paper_portfolios to authenticated;
grant select on public.paper_positions to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
