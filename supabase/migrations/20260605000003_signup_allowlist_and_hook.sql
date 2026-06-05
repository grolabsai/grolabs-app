-- User & account management — PR3 (docs/policy/user-management.md §5.2)
--
-- "Pre-created emails only" enforcement for SSO. There is no public self-signup:
-- accounts are created only by GroLabs staff (createCustomerAccount) or a Tenant
-- Admin (createTenantUser). Those actions insert the email into signup_allowlist
-- BEFORE creating the auth user. The Before-User-Created auth hook below rejects
-- any user creation whose email is not allow-listed — so an unknown Google /
-- Microsoft sign-in is refused instead of silently creating an orphan account.
--
-- The hook is SHIPPED here but ENABLED manually in the Supabase dashboard
-- (Authentication → Hooks → Before User Created → select this function) — that is
-- Configuration task C6. Until enabled it has no effect; the layout no-access
-- gate is the runtime belt-and-suspenders in the meantime.

create table if not exists public.signup_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

comment on table public.signup_allowlist is
  'Emails an admin has provisioned. The before_user_created_restrict auth hook allows account creation only for these. Per docs/policy/user-management.md §5.2.';

alter table public.signup_allowlist enable row level security;
-- No policies: only service_role (bypasses RLS, used by the create actions) and
-- the auth hook role (granted explicitly below) ever read/write this table.

-- Seed already-provisioned users so their existing accounts can link an SSO
-- identity (same-email automatic linking) without being rejected by the hook.
insert into public.signup_allowlist (email)
select lower(email) from auth.users where email is not null
on conflict (email) do nothing;

create or replace function public.before_user_created_restrict(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_email text;
begin
  v_email := lower(coalesce(
    event #>> '{user,email}',
    event #>> '{claims,email}',
    event #>> '{email}'
  ));

  if v_email is not null and exists (
    select 1 from public.signup_allowlist a where a.email = v_email
  ) then
    return '{}'::jsonb;  -- allow
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Tu cuenta no está habilitada. Pedí a un administrador de GroLabs que la cree.'
    )
  );
end;
$$;

comment on function public.before_user_created_restrict(jsonb) is
  'Supabase Before-User-Created auth hook: allow only allow-listed (admin-provisioned) emails. Rejects organic SSO signups. Enable in the dashboard (Config task C6). Per docs/policy/user-management.md §5.2.';

-- The auth hook executes as the supabase_auth_admin role.
grant execute on function public.before_user_created_restrict(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created_restrict(jsonb) from authenticated, anon, public;
grant select on public.signup_allowlist to supabase_auth_admin;
