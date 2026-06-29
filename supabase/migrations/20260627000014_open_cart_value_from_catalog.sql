-- DEC-2 (delta model): cart state is computed in the backend from frontend
-- deltas. Open-cart value = Σ over the cart's 'Added to cart' deltas of
-- (catalog price × delta quantity), joining object_id → product.woocommerce_id.
-- Falls back to 0 when a product isn't in the catalog (caller then AOV-estimates).
create or replace function public.instance_open_cart_summary(p_instance int)
returns table (
  carts bigint, value_sum numeric, aov numeric,
  today bigint, d1 bigint, d2 bigint, d3_10 bigint, d10_30 bigint
)
language sql stable security definer set search_path = public
as $$
  with cart_events as (
    select cart_id, event_name, object_id, quantity, created_at
    from analytics_event
    where instance_id = p_instance and cart_id is not null
  ),
  cart_state as (
    select cart_id,
           max(created_at) as last_at,
           bool_or(event_name = 'Completed order') as ordered,
           bool_or(event_name = 'Removed from cart') as removed,
           bool_or(event_name in ('Added to cart','Added to cart from PDP','Added to cart from PLP','Proceeded to check out')) as has_cart
    from cart_events
    group by cart_id
  ),
  open_carts as (
    select cart_id, extract(epoch from (now() - last_at)) / 86400.0 as age_days
    from cart_state
    where has_cart and not ordered and not removed
      and (now() - last_at) < interval '30 days'
  ),
  cart_val as (
    select oc.cart_id,
           coalesce(sum(coalesce(p.sale_price, p.price) * coalesce(ce.quantity, 1)), 0)::numeric as val
    from open_carts oc
    join cart_events ce on ce.cart_id = oc.cart_id and ce.event_name = 'Added to cart'
    left join product p on p.instance_id = p_instance
      and p.woocommerce_id = (case when ce.object_id ~ '^[0-9]+$' then ce.object_id::bigint else null end)
    group by oc.cart_id
  ),
  aov_calc as (
    select coalesce(avg(value), 0) as aov
    from analytics_event
    where instance_id = p_instance and event_name = 'Completed order'
      and value is not null and created_at >= now() - interval '30 days'
  )
  select
    count(*)::bigint,
    coalesce(sum(cv.val), 0)::numeric,
    (select aov from aov_calc)::numeric,
    count(*) filter (where oc.age_days < 1)::bigint,
    count(*) filter (where oc.age_days >= 1  and oc.age_days < 2)::bigint,
    count(*) filter (where oc.age_days >= 2  and oc.age_days < 3)::bigint,
    count(*) filter (where oc.age_days >= 3  and oc.age_days < 10)::bigint,
    count(*) filter (where oc.age_days >= 10 and oc.age_days < 30)::bigint
  from open_carts oc
  left join cart_val cv on cv.cart_id = oc.cart_id;
$$;
