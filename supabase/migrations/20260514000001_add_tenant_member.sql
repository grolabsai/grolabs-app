-- ============================================================================
-- Add tenant_member
-- ----------------------------------------------------------------------------
-- Direct user-to-tenant membership. Parallel to instance_member but one layer
-- up — answers "which tenants does this user belong to?" without joining
-- through instances. Required precondition for instance_member rows in the
-- same tenant (enforced by trigger).
--
-- Spec: docs/policy/tenant-membership.md
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Pre-cleanup: rename naming-debt artefacts on instance_member
-- ----------------------------------------------------------------------------
-- instance_member's indexes/sequence/PK constraint are named tenant_member_*
-- because the table was renamed from `tenant_member` -> `instance_member` in
-- an earlier migration without renaming its dependent objects. These names
-- collide with the new tenant_member table we're about to create. Pure
-- metadata renames — no data movement, no behaviour change. Identity-column
-- binding to the sequence is by OID, not name, and is preserved.
-- (CLAUDE.md §17 — naming debt cleanup.)

alter index    public.tenant_member_pkey                  rename to instance_member_pkey;
alter index    public.tenant_member_tenant_id_idx         rename to instance_member_instance_id_active_idx;
alter index    public.tenant_member_tenant_id_user_id_key rename to instance_member_instance_id_user_id_key;
alter index    public.tenant_member_user_id_idx           rename to instance_member_user_id_active_idx;
alter sequence public.tenant_member_member_id_seq         rename to instance_member_member_id_seq;

-- ----------------------------------------------------------------------------
-- 1. tenant_member table
-- ----------------------------------------------------------------------------

create table public.tenant_member (
  tenant_member_id bigserial primary key,
  tenant_id        bigint   not null references public.tenant(tenant_id) on delete cascade,
  user_id          uuid     not null,
  role             text     not null default 'member'
                   check (role in ('owner', 'admin', 'billing', 'member')),
  is_active        boolean  not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, user_id)
);

comment on table public.tenant_member is
  'A user''s direct membership in a tenant. Parallel to instance_member but at the tenant level. Required precondition for any instance_member row in the same tenant (enforced by trigger trg_enforce_tenant_member_before_instance_member). See docs/policy/tenant-membership.md.';

comment on column public.tenant_member.role is
  'Tenant-level role. owner = full control incl. delete tenant; admin = manage instances and members; billing = manage billing only; member = baseline access, no admin powers.';

-- Helpful covering index for "which tenants does this user belong to?" lookups.
-- The UNIQUE (tenant_id, user_id) index already covers (tenant_id, user_id)
-- prefix lookups; this adds the user_id-first direction used by signup/home-tenant queries.
create index tenant_member_user_id_idx on public.tenant_member(user_id);

-- ----------------------------------------------------------------------------
-- 2. Backfill from existing instance_member rows
-- ----------------------------------------------------------------------------
-- One tenant_member row per distinct (instance.tenant_id, user_id) pair from
-- active instance_member rows. Every existing instance_member is role='owner',
-- so the backfill assigns role='owner' at the tenant level to preserve intent.

insert into public.tenant_member (tenant_id, user_id, role, is_active)
select distinct i.tenant_id, im.user_id, 'owner', true
  from public.instance_member im
  join public.instance i on im.instance_id = i.instance_id
 where im.is_active = true
on conflict (tenant_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Enforcement trigger on instance_member
-- ----------------------------------------------------------------------------
-- BEFORE INSERT only. UPDATE flows today never change user_id or instance_id;
-- a future PR that introduces such a flow must reassess. We raise (not silently
-- auto-create) so buggy callers fail loud instead of papering over the wrong
-- tenant.

create or replace function public.enforce_tenant_member_before_instance_member()
returns trigger
language plpgsql
as $$
declare
  v_tenant_id bigint;
begin
  select tenant_id
    into v_tenant_id
    from public.instance
   where instance_id = new.instance_id;

  if v_tenant_id is null then
    raise exception
      'instance_member insert failed: instance % does not exist or has no tenant',
      new.instance_id;
  end if;

  if not exists (
    select 1
      from public.tenant_member
     where tenant_id = v_tenant_id
       and user_id = new.user_id
       and is_active = true
  ) then
    raise exception
      'instance_member insert failed: user % is not an active tenant_member of tenant % (the tenant owning instance %). Create the tenant_member row first.',
      new.user_id, v_tenant_id, new.instance_id;
  end if;

  return new;
end;
$$;

comment on function public.enforce_tenant_member_before_instance_member() is
  'Enforces the tenant_member -> instance_member precondition. Raises if an instance_member is inserted for a (user, tenant) pair that has no active tenant_member row. See docs/policy/tenant-membership.md §4.';

create trigger trg_enforce_tenant_member_before_instance_member
  before insert on public.instance_member
  for each row
  execute function public.enforce_tenant_member_before_instance_member();

-- ----------------------------------------------------------------------------
-- 4. updated_at touch trigger
-- ----------------------------------------------------------------------------
-- Reuses the existing public.set_updated_at() function. The older tables
-- (tenant, instance, instance_member) do not have this wired up today; that
-- backfill is a separate cleanup PR (see policy doc §7).

create trigger trg_tenant_member_set_updated_at
  before update on public.tenant_member
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
-- SELECT: a user may read only their own tenant_member rows.
-- INSERT/UPDATE/DELETE: no policy for `authenticated` -> blocked. Writes flow
-- through service_role / SECURITY DEFINER RPCs in future PRs (signup, invite).

alter table public.tenant_member enable row level security;

create policy tenant_member_select_self on public.tenant_member
  for select to authenticated
  using (user_id = auth.uid());

commit;
