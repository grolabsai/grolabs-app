-- Bridge: until server-side order firing lands, client 'Completed order' events
-- keep sales_order current so revenue (now sourced from sales_order) doesn't miss
-- new orders. Idempotent; the conditional update never clobbers a server/SDK order.
create or replace function public.recompute_order(p_instance bigint, p_order_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric; v_items int; v_qty int;
  v_user text; v_account text; v_cart text; v_created timestamptz;
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
  insert into sales_order (instance_id, order_id, amount, item_count, total_quantity,
                           user_id, account_id, cart_id, source, created_at)
  values (p_instance, p_order_id, v_amount, v_items, v_qty,
          v_user, v_account, v_cart, 'woocommerce_event', v_created)
  on conflict (instance_id, order_id) do update set
    amount = excluded.amount, item_count = excluded.item_count, total_quantity = excluded.total_quantity,
    user_id = coalesce(excluded.user_id, sales_order.user_id),
    account_id = coalesce(excluded.account_id, sales_order.account_id),
    cart_id = coalesce(excluded.cart_id, sales_order.cart_id),
    updated_at = now()
  where sales_order.source = 'woocommerce_event';
end; $$;

create or replace function public.trg_order_from_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.event_name = 'Completed order' and NEW.order_id is not null then
    perform public.recompute_order(NEW.instance_id, NEW.order_id);
  end if;
  return NEW;
end; $$;
drop trigger if exists order_from_event on public.analytics_event;
create trigger order_from_event after insert on public.analytics_event
  for each row execute function public.trg_order_from_event();
