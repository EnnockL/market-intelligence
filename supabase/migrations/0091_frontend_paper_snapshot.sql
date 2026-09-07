-- One statement snapshot of observed simulation state. This read model does not
-- make the existing multi-statement paper execution/valuation writers atomic,
-- nor certify their prices, FX assumptions or execution economics as verified.
create index if not exists paper_portfolios_scope_read_idx
  on public.paper_portfolios(portfolio_scope, created_at, id);
create index if not exists paper_positions_snapshot_read_idx
  on public.paper_positions(portfolio_id, id);

create or replace function public.frontend_paper_snapshot_v1()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with selected as materialized (
    select p.id,p.name,p.policy_version,p.initial_capital_sek,p.cash_sek,p.base_currency,p.created_at
    from public.paper_portfolios p where p.portfolio_scope='SYSTEM_RESEARCH'
    order by p.created_at,p.id limit 21
  ), summaries as (
    select p.*,s.*,
      p.base_currency is not null and p.base_currency='SEK'
      and p.initial_capital_sek is not null and p.cash_sek is not null
      and p.initial_capital_sek>0 and p.cash_sek>=0
      and p.initial_capital_sek::text not in ('NaN','Infinity','-Infinity')
      and p.cash_sek::text not in ('NaN','Infinity','-Infinity')
      and s.values_known as values_known_all
    from selected p
    cross join lateral (
      select count(*) as position_count,
        count(*) filter(where q.closed_at is null) as open_positions,
        count(*) filter(where q.closed_at is not null) as closed_trades,
        coalesce(sum(q.market_value) filter(where q.closed_at is null),0) as open_value,
        coalesce(sum(q.realized_pnl),0) as realized_pnl,
        coalesce(sum(q.unrealized_pnl) filter(where q.closed_at is null),0) as unrealized_pnl,
        coalesce(bool_and(
          q.quantity is not null and q.quantity>=0 and q.quantity::text not in ('NaN','Infinity','-Infinity')
          and q.realized_pnl is not null and q.realized_pnl::text not in ('NaN','Infinity','-Infinity')
          and (q.closed_at is not null or (
            q.market_value is not null and q.market_value>=0 and q.market_value::text not in ('NaN','Infinity','-Infinity')
            and q.unrealized_pnl is not null and q.unrealized_pnl::text not in ('NaN','Infinity','-Infinity')
            and (q.quantity=0 or (q.current_price is not null and q.current_price>0
              and q.current_price::text not in ('NaN','Infinity','-Infinity')))
          ))
        ),true) as values_known
      from (select pos.quantity,pos.current_price,pos.market_value,pos.realized_pnl,pos.unrealized_pnl,pos.closed_at
        from public.paper_positions pos where pos.portfolio_id=p.id order by pos.id limit 5001) q
    ) s
    where (select count(*) from selected)<=20
  ), result as (
    select case
      when (select count(*) from selected)>20 or coalesce(bool_or(s.position_count>5000),false) then 'READ_BUDGET_EXCEEDED'
      when coalesce(bool_or(s.values_known_all is not true),false) then 'VALUATION_UNAVAILABLE'
      else null end as reason,
      coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.name,'policy',s.policy_version,'initial',s.initial_capital_sek,'cash',s.cash_sek,
        'equity',s.cash_sek+s.open_value,'returnPct',((s.cash_sek+s.open_value)/nullif(s.initial_capital_sek,0)-1)*100,
        'openPositions',s.open_positions,'closedTrades',s.closed_trades,
        'realizedPnl',s.realized_pnl,'unrealizedPnl',s.unrealized_pnl
      ) order by s.created_at,s.id),'[]'::jsonb) as portfolios from summaries s
  )
  select jsonb_build_object('version','frontend-paper-snapshot-v1','capturedAt',statement_timestamp(),
    'status',case when r.reason is null then 'READY' else 'UNAVAILABLE' end,'reason',r.reason,
    'portfolios',case when r.reason is null then r.portfolios else '[]'::jsonb end) from result r;
$$;
revoke all on function public.frontend_paper_snapshot_v1() from public,anon,authenticated;
grant execute on function public.frontend_paper_snapshot_v1() to service_role;
comment on function public.frontend_paper_snapshot_v1() is
  'Bounded, same-statement observed SYSTEM_RESEARCH simulation balances. No private portfolios, row histories, writes, or certification of paper execution economics.';
