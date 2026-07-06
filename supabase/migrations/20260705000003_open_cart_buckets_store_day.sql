-- Open-cart buckets by STORE-LOCAL CALENDAR DAY, not rolling 24h age.
--
-- A cart opened yesterday evening showed under "Today" until 24h had passed —
-- twice misread by the merchant. With instance.timezone in place (migration
-- 20260705000001), "Today"/"Yesterday" now mean the store's calendar days:
-- bucket = instance_day(now()) - instance_day(last_event_at).
create or replace function public.instance_open_cart_summary(p_instance int)
returns table (
  carts bigint, value_sum numeric, aov numeric,
  today bigint, d1 bigint, d2 bigint, d3_10 bigint, d10_30 bigint
)
language sql stable security definer set search_path = public
as $$
  with oc as (
    select value,
           (public.instance_day(p_instance, now())
            - public.instance_day(p_instance, last_event_at)) as days_ago
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
    count(*) filter (where days_ago <= 0)::bigint,                -- today (store-local)
    count(*) filter (where days_ago = 1)::bigint,                 -- yesterday
    count(*) filter (where days_ago = 2)::bigint,                 -- 2 days ago
    count(*) filter (where days_ago between 3 and 9)::bigint,     -- 3–10 days
    count(*) filter (where days_ago between 10 and 29)::bigint    -- 10–30 days
  from oc;
$$;

comment on function public.instance_open_cart_summary(int) is
  'Live open-cart summary bucketed by the STORE''s calendar days (instance.timezone): today / yesterday / 2 d / 3-10 d / 10-30 d since last cart activity. Value from cart.value (exact when the catalog is present).';
