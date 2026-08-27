create or replace function public.propagate_strategy_attribution() returns trigger language plpgsql as $$declare expected uuid;begin
 if tg_table_name='trade_eligibility_evaluations' then select strategy_attribution_id into expected from public.trade_proposals where id=new.proposal_id;
 elsif tg_table_name='execution_orders' then select strategy_attribution_id into expected from public.execution_intents where id=new.intent_id;
 elsif tg_table_name='execution_fills' then select strategy_attribution_id into expected from public.execution_orders where id=new.order_id;
 end if;
 if new.strategy_attribution_id is not null and new.strategy_attribution_id is distinct from expected then raise exception 'strategy attribution lineage mismatch';end if;
 new.strategy_attribution_id:=expected;return new;end;$$;
create trigger trade_eligibility_attribution before insert on public.trade_eligibility_evaluations for each row execute function public.propagate_strategy_attribution();
create trigger execution_order_attribution before insert on public.execution_orders for each row execute function public.propagate_strategy_attribution();
create trigger execution_fill_attribution before insert on public.execution_fills for each row execute function public.propagate_strategy_attribution();
