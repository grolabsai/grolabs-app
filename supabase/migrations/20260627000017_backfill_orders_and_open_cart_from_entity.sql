-- Backfill sales_order from historical Completed-order events (revenue continuity
-- before server-side order firing). Idempotent on (instance_id, order_id).
insert into public.sales_order (instance_id, order_id, amount, currency, item_count, total_quantity, user_id, account_id, cart_id, source, created_at)
select instance_id, order_id,
       coalesce(sum(value), 0)             as amount,
       'USD',
       count(*)                            as item_count,
       coalesce(sum(quantity), 0)          as total_quantity,
       max(user_id)    filter (where user_id is not null),
       max(account_id) filter (where account_id is not null),
       max(cart_id)    filter (where cart_id is not null),
       'woocommerce',
       min(created_at)
from public.analytics_event
where event_name = 'Completed order' and order_id is not null
group by instance_id, order_id
on conflict (instance_id, order_id) do nothing;

-- Open-cart summary now reads the cart ENTITY (status='open'); value from
-- cart.value, age from last_event_at, aov from sales_order.
create or replace function public.instance_open_cart_summary(p_instance int)
returns table (
  carts bigint, value_sum numeric, aov numeric,
  today bigint, d1 bigint, d2 bigint, d3_10 bigint, d10_30 bigint
)
language sql stable security definer set search_path = public
as $$
  with oc as (
    select value, extract(epoch from (now() - last_event_at)) / 86400.0 as age_days
    from cart
    where instance_id = p_instance and status = 'open'
      and (now() - last_event_at) < interval '30 days'
  ),
  aov_calc as (
    select coalesce(avg(amount), 0) as aov
    from sales_order
    where instance_id = p_instance and created_at >= now() - interval '30 days'
  )
  select
    count(*)::bigint,
    coalesce(sum(value), 0)::numeric,
    (select aov from aov_calc)::numeric,
    count(*) filter (where age_days < 1)::bigint,
    count(*) filter (where age_days >= 1  and age_days < 2)::bigint,
    count(*) filter (where age_days >= 2  and age_days < 3)::bigint,
    count(*) filter (where age_days >= 3  and age_days < 10)::bigint,
    count(*) filter (where age_days >= 10 and age_days < 30)::bigint
  from oc;
$$;
