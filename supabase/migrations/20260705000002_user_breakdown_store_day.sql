-- Store-local day windows for the Traffic user donut + daily-users series
-- (companion to 20260705000001: p_start/p_end are STORE-LOCAL dates now, so
-- window membership and the daily grouping use instance_day() instead of the
-- raw UTC ::date). Signatures unchanged.

create or replace function public.instance_user_breakdown(
  p_instance int,
  p_start date,
  p_end date
)
returns table (
  total bigint,
  new_users bigint,
  returning_users bigint,
  anonymous bigint,
  registered bigint,
  new_registered bigint,
  returning_registered bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with lifetime as (
    select user_id,
           min(created_at) as first_seen,
           bool_or(account_id is not null) as has_acct
    from analytics_event
    where instance_id = p_instance and user_id is not null
    group by user_id
  ),
  inwin as (
    select distinct user_id
    from analytics_event
    where instance_id = p_instance and user_id is not null
      and public.instance_day(p_instance, created_at) between p_start and p_end
  )
  select
    count(*)::bigint,
    count(*) filter (where public.instance_day(p_instance, l.first_seen) >= p_start)::bigint,
    count(*) filter (where public.instance_day(p_instance, l.first_seen) <  p_start)::bigint,
    count(*) filter (where not l.has_acct)::bigint,
    count(*) filter (where l.has_acct)::bigint,
    count(*) filter (where l.has_acct and public.instance_day(p_instance, l.first_seen) >= p_start)::bigint,
    count(*) filter (where l.has_acct and public.instance_day(p_instance, l.first_seen) <  p_start)::bigint
  from inwin i join lifetime l using (user_id);
$$;

create or replace function public.instance_daily_users(
  p_instance int,
  p_start date,
  p_end date
)
returns table (day date, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  select public.instance_day(p_instance, created_at) as day,
         count(distinct user_id)::bigint as users
  from analytics_event
  where instance_id = p_instance and user_id is not null
    and public.instance_day(p_instance, created_at) between p_start and p_end
  group by public.instance_day(p_instance, created_at)
  order by day;
$$;
