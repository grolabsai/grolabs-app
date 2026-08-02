-- Tenant-isolation RLS coverage audit.
--
-- The functional test (scripts/test-tenant-isolation.mjs) proves isolation on a
-- couple of tables. THIS query proves COVERAGE: it lists every table that has an
-- `instance_id` column and flags any that has RLS disabled or no isolation
-- policy. That's the systemic risk — a new table that carries instance_id but
-- forgot RLS is a silent cross-tenant leak.
--
-- How to run: paste into Supabase Studio → SQL editor (against the target
-- project) and execute. No writes; read-only against the catalog.
--
-- Reading the verdict column:
--   'RLS DISABLED — LEAK RISK'      → fix before any client touches the DB.
--   'RLS on but NO POLICIES'        → table is fully blocked for `authenticated`
--                                     (reachable only via service_role). Safe
--                                     from leaks, but confirm that's intended.
--   'no current_instance_id() ref'  → has policies but none mention the standard
--                                     isolation helper. Likely isolated a
--                                     different way (e.g. funnel tenant_read, or
--                                     a membership join) — VERIFY manually.
--   'ok'                            → RLS on + at least one policy references
--                                     current_instance_id().

with instance_tables as (
  select c.oid, c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and exists (
      select 1
      from pg_attribute a
      where a.attrelid = c.oid
        and a.attname = 'instance_id'
        and a.attnum > 0
        and not a.attisdropped
    )
),
policy_stats as (
  select
    tablename,
    count(*) as policy_count,
    count(*) filter (
      where coalesce(qual, '')      ilike '%current_instance_id%'
         or coalesce(with_check,'') ilike '%current_instance_id%'
    ) as isolation_policies
  from pg_policies
  where schemaname = 'public'
  group by tablename
)
select
  it.table_name,
  c.relrowsecurity                       as rls_enabled,
  c.relforcerowsecurity                  as rls_forced,
  coalesce(ps.policy_count, 0)           as policies,
  coalesce(ps.isolation_policies, 0)     as isolation_policies,
  case
    when not c.relrowsecurity                       then 'RLS DISABLED — LEAK RISK'
    when coalesce(ps.policy_count, 0) = 0           then 'RLS on but NO POLICIES (service_role only?)'
    when coalesce(ps.isolation_policies, 0) = 0     then 'no current_instance_id() ref — VERIFY'
    else 'ok'
  end as verdict
from instance_tables it
join pg_class c on c.oid = it.oid
left join policy_stats ps on ps.tablename = it.table_name
order by
  (not c.relrowsecurity) desc,                       -- RLS-off first
  (coalesce(ps.policy_count, 0) = 0) desc,           -- then no-policy
  (coalesce(ps.isolation_policies, 0) = 0) desc,     -- then no-isolation-ref
  it.table_name;

-- One-line summary: how many instance_id tables are NOT clean?
-- (RLS off, or zero policies.) Anything > 0 needs review before M1.
with instance_tables as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'instance_id'
                  and a.attnum > 0 and not a.attisdropped)
)
select
  count(*) as instance_scoped_tables,
  count(*) filter (where not c.relrowsecurity) as rls_disabled,
  count(*) filter (where c.relrowsecurity and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )) as rls_on_no_policies
from instance_tables it
join pg_class c on c.oid = it.oid;
