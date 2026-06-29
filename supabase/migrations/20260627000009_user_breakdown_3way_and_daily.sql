-- Traffic user donut: clean 3-way partition of total users
--   anonymous            = no account ever
--   new_registered       = identified AND first activity inside the window
--   returning_registered = identified AND first activity predates the window
-- Plus a daily distinct-user series for the Users timeline.
drop function if exists public.instance_user_breakdown(int, date, date);

create function public.instance_user_breakdown(
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
      and created_at >= p_start::timestamptz
      and created_at <  (p_end + 1)::timestamptz
  )
  select
    count(*)::bigint,
    count(*) filter (where l.first_seen >= p_start::timestamptz)::bigint,
    count(*) filter (where l.first_seen <  p_start::timestamptz)::bigint,
    count(*) filter (where not l.has_acct)::bigint,
    count(*) filter (where l.has_acct)::bigint,
    count(*) filter (where l.has_acct and l.first_seen >= p_start::timestamptz)::bigint,
    count(*) filter (where l.has_acct and l.first_seen <  p_start::timestamptz)::bigint
  from inwin i join lifetime l using (user_id);
$$;

grant execute on function public.instance_user_breakdown(int, date, date) to authenticated, service_role;

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
  select created_at::date as day, count(distinct user_id)::bigint as users
  from analytics_event
  where instance_id = p_instance and user_id is not null
    and created_at >= p_start::timestamptz
    and created_at <  (p_end + 1)::timestamptz
  group by created_at::date
  order by day;
$$;

grant execute on function public.instance_daily_users(int, date, date) to authenticated, service_role;
