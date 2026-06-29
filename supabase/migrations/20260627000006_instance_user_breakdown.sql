-- Users section: spine-derived identity + recency breakdown for the Overview
-- dashboard. Sourced from analytics_event so it works even when GA4 isn't
-- connected. (Superseded by 20260627000009, which adds the identity-coupled
-- new/returning columns — kept here for migration history.)
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
  registered bigint
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
    count(*) filter (where l.has_acct)::bigint
  from inwin i join lifetime l using (user_id);
$$;

grant execute on function public.instance_user_breakdown(int, date, date) to authenticated, service_role;
