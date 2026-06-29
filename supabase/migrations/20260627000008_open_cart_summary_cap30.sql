-- Carts tab: cap open carts at 30 days (older = dead tail, no >30 bucket).
-- Drops d30plus; open_carts now filters age_days < 30.
drop function if exists public.instance_open_cart_summary(int);

create function public.instance_open_cart_summary(p_instance int)
returns table (
  carts bigint,
  value_sum numeric,
  aov numeric,
  today bigint,
  d1 bigint,
  d2 bigint,
  d3_10 bigint,
  d10_30 bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with cart_state as (
    select cart_id,
           max(created_at) as last_at,
           bool_or(event_name = 'Completed order') as ordered,
           bool_or(event_name = 'Removed from cart') as removed,
           bool_or(event_name in ('Added to cart from PDP','Added to cart from PLP','Proceeded to check out')) as has_cart,
           max(value) filter (where value is not null) as cart_value
    from analytics_event
    where instance_id = p_instance and cart_id is not null
    group by cart_id
  ),
  open_carts as (
    select cart_value,
           extract(epoch from (now() - last_at)) / 86400.0 as age_days
    from cart_state
    where has_cart and not ordered and not removed
      and (now() - last_at) < interval '30 days'
  ),
  aov_calc as (
    select coalesce(avg(value), 0) as aov
    from analytics_event
    where instance_id = p_instance and event_name = 'Completed order'
      and value is not null and created_at >= now() - interval '30 days'
  )
  select
    count(*)::bigint,
    coalesce(sum(o.cart_value), 0)::numeric,
    (select aov from aov_calc)::numeric,
    count(*) filter (where age_days < 1)::bigint,
    count(*) filter (where age_days >= 1  and age_days < 2)::bigint,
    count(*) filter (where age_days >= 2  and age_days < 3)::bigint,
    count(*) filter (where age_days >= 3  and age_days < 10)::bigint,
    count(*) filter (where age_days >= 10 and age_days < 30)::bigint
  from open_carts o;
$$;

grant execute on function public.instance_open_cart_summary(int) to authenticated, service_role;
