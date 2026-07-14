-- The order-from-event bridge (20260627000019) inserted sales_order rows
-- without a currency, so the column default ('USD') stamped every
-- event-derived order regardless of the store's real currency — found live
-- 2026-07-14 on instance 12 (GTQ store, USD bridge rows next to a correct
-- GTQ server row). Client 'Completed order' events carry no currency, so the
-- honest source is the instance's own default_currency.
create or replace function public.recompute_order(p_instance bigint, p_order_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric; v_items int; v_qty int;
  v_user text; v_account text; v_cart text; v_created timestamptz;
  v_currency text;
begin
  select coalesce(sum(value),0), count(*), coalesce(sum(quantity),0),
         max(user_id)    filter (where user_id is not null),
         max(account_id) filter (where account_id is not null),
         max(cart_id)    filter (where cart_id is not null),
         min(created_at)
    into v_amount, v_items, v_qty, v_user, v_account, v_cart, v_created
  from analytics_event
  where instance_id = p_instance and order_id = p_order_id and event_name = 'Completed order';
  if v_created is null then return; end if;

  select coalesce(default_currency, 'USD') into v_currency
  from instance where instance_id = p_instance;

  insert into sales_order (instance_id, order_id, amount, currency, item_count, total_quantity,
                           user_id, account_id, cart_id, source, created_at)
  values (p_instance, p_order_id, v_amount, coalesce(v_currency, 'USD'), v_items, v_qty,
          v_user, v_account, v_cart, 'woocommerce_event', v_created)
  on conflict (instance_id, order_id) do update set
    amount = excluded.amount, currency = excluded.currency,
    item_count = excluded.item_count, total_quantity = excluded.total_quantity,
    user_id = coalesce(excluded.user_id, sales_order.user_id),
    account_id = coalesce(excluded.account_id, sales_order.account_id),
    cart_id = coalesce(excluded.cart_id, sales_order.cart_id),
    updated_at = now()
  where sales_order.source = 'woocommerce_event';
end; $$;

-- Backfill: existing bridge rows got the USD default; restamp them from
-- their instance. Server-sourced rows already carry the order's true
-- currency and are untouched.
update sales_order so
set currency = coalesce(i.default_currency, so.currency), updated_at = now()
from instance i
where i.instance_id = so.instance_id
  and so.source = 'woocommerce_event'
  and so.currency is distinct from coalesce(i.default_currency, so.currency);
