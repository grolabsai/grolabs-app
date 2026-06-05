-- User & account management — PR2 (docs/policy/user-management.md §8)
--
-- is_grolabs_admin() — SQL mirror of the application isGroLabsAdmin() check, so
-- RLS / RPCs can reuse it. True iff the current auth user is an active
-- tenant_member of the template-owner tenant (the tenant that owns instance 0).
-- This is what closes SEC-001: the admin surface gate becomes a real check.

create or replace function public.is_grolabs_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.tenant_member tm
      join public.tenant t on t.tenant_id = tm.tenant_id
     where tm.user_id = auth.uid()
       and tm.is_active = true
       and t.kind = 'template_owner'
  );
$$;

comment on function public.is_grolabs_admin() is
  'True when the current auth user is an active tenant_member of the template-owner (GroLabs) tenant. Mirrors src/lib/auth/admin.ts isGroLabsAdmin(). Closes SEC-001. Per docs/policy/user-management.md §8.';

grant execute on function public.is_grolabs_admin() to authenticated;
