-- User & account management — PR1 (docs/policy/user-management.md §2.1, §2.2)
--
-- 1. tenant.domain — the tenant identity key per Constitution Article 3
--    ("tenant identity is keyed by domain"). Logical identity; tenant_id stays
--    the physical surrogate PK (instance.tenant_id / tenant_member.tenant_id
--    already FK to it). Unique case-insensitive, partial so multiple NULLs are
--    allowed during the nullable-backfill window.
-- 2. is_tenant_admin(p_tenant_id) — SECURITY DEFINER helper gating the
--    user-management actions (RRE "Equipo"): true when the current auth user is
--    an active tenant_member of that tenant with role in (owner, admin).

alter table public.tenant
  add column if not exists domain text;

comment on column public.tenant.domain is
  'Tenant identity key (Constitution Article 3): the company domain, lowercased, unique. tenant_id remains the physical PK. Customer tenants must populate it; resolve-or-create by domain on customer creation. Per docs/policy/user-management.md.';

create unique index if not exists uq_tenant_domain
  on public.tenant (lower(domain))
  where domain is not null;

-- The GroLabs template-owner tenant gets its own identity domain.
update public.tenant
   set domain = 'grolabs.ai', updated_at = now()
 where kind = 'template_owner'
   and domain is null;

create or replace function public.is_tenant_admin(p_tenant_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.tenant_member tm
     where tm.tenant_id = p_tenant_id
       and tm.user_id = auth.uid()
       and tm.is_active = true
       and tm.role in ('owner', 'admin')
  );
$$;

comment on function public.is_tenant_admin(bigint) is
  'True when the current auth user is an active tenant_member of p_tenant_id with role owner or admin. Gates user-management server actions. Per docs/policy/user-management.md §2.2.';

grant execute on function public.is_tenant_admin(bigint) to authenticated;
