-- ============================================================================
-- Add tenant layer
-- ----------------------------------------------------------------------------
-- Creates a `tenant` table that owns one or more `instance` rows. Backfills
-- existing instances: GroLabs (template_owner) owns instance 0; Wazú (customer)
-- owns instances 1 and 3. `instance.kind` is deprecated but NOT dropped — a
-- trigger keeps it in sync with `tenant.kind` for the deprecation window.
--
-- Spec: docs/policy/tenant-model.md
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. tenant table
-- ----------------------------------------------------------------------------

create table public.tenant (
  tenant_id  bigserial primary key,
  name       text not null,
  slug       text not null unique,
  kind       text not null check (kind in ('template_owner', 'customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenant is
  'Tenants own one or more instances. kind=template_owner instances are Scout-owned blueprints; kind=customer instances are customer catalogs.';

-- ----------------------------------------------------------------------------
-- 2. instance.tenant_id (nullable for now; set NOT NULL after backfill)
-- ----------------------------------------------------------------------------

alter table public.instance
  add column tenant_id bigint references public.tenant(tenant_id);

create index instance_tenant_id_idx on public.instance(tenant_id);

-- ----------------------------------------------------------------------------
-- 3. Seed tenants
-- ----------------------------------------------------------------------------

insert into public.tenant (name, slug, kind) values
  ('GroLabs', 'grolabs', 'template_owner'),
  ('Wazú',    'wazu',    'customer');

-- ----------------------------------------------------------------------------
-- 4. Backfill instance.tenant_id by slug lookup
-- ----------------------------------------------------------------------------

update public.instance
   set tenant_id = (select tenant_id from public.tenant where slug = 'grolabs')
 where instance_id = 0;

update public.instance
   set tenant_id = (select tenant_id from public.tenant where slug = 'wazu')
 where instance_id in (1, 3);

-- Defensive: fail loudly if any instance row was missed before we add NOT NULL.
do $$
declare
  unmapped int;
begin
  select count(*) into unmapped from public.instance where tenant_id is null;
  if unmapped > 0 then
    raise exception 'tenant backfill incomplete: % instance row(s) with tenant_id IS NULL', unmapped;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Lock it down
-- ----------------------------------------------------------------------------

alter table public.instance
  alter column tenant_id set not null;

-- ----------------------------------------------------------------------------
-- 6. Deprecate instance.kind (kept; trigger below keeps it in sync)
-- ----------------------------------------------------------------------------

comment on column public.instance.kind is
  'DEPRECATED. Use instance.tenant_id -> tenant.kind instead. Kept for backward compatibility; do not read from this column in new code. To be dropped in a follow-up migration once all readers are migrated.';

-- ----------------------------------------------------------------------------
-- 7. Sync trigger: instance.kind follows tenant.kind
-- ----------------------------------------------------------------------------
-- For the deprecation window, any INSERT/UPDATE of `instance` derives
-- instance.kind from the parent tenant. Callers do not need to set kind;
-- if they do, it gets overwritten to the tenant-consistent value.

create or replace function public.instance_sync_kind_from_tenant()
returns trigger
language plpgsql
as $$
declare
  parent_kind text;
begin
  select t.kind into parent_kind
    from public.tenant t
   where t.tenant_id = new.tenant_id;

  if parent_kind is null then
    raise exception 'instance.tenant_id=% does not match any tenant row', new.tenant_id;
  end if;

  if parent_kind = 'template_owner' then
    new.kind := 'template';
  elsif parent_kind = 'customer' then
    new.kind := 'customer';
  else
    raise exception 'unknown tenant.kind=%', parent_kind;
  end if;

  return new;
end;
$$;

comment on function public.instance_sync_kind_from_tenant() is
  'Deprecation-window helper: forces instance.kind to match parent tenant.kind on every INSERT/UPDATE. Drop together with instance.kind in a follow-up migration.';

create trigger instance_sync_kind_from_tenant_trg
before insert or update of tenant_id, kind on public.instance
for each row execute function public.instance_sync_kind_from_tenant();

-- ----------------------------------------------------------------------------
-- 8. RLS on tenant
-- ----------------------------------------------------------------------------
-- SELECT: members of any instance owned by this tenant can read it.
-- INSERT/UPDATE/DELETE: service_role only (no policy => no access for
-- authenticated). Tenant writes are administrative and currently happen
-- through migrations or service-role flows.

alter table public.tenant enable row level security;

create policy tenant_select_for_members on public.tenant
  for select to authenticated
  using (
    exists (
      select 1
        from public.instance i
        join public.instance_member m on m.instance_id = i.instance_id
       where i.tenant_id = tenant.tenant_id
         and m.user_id = auth.uid()
         and m.is_active = true
    )
  );

commit;
