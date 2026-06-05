-- User & account management — PR4/PR5 (docs/policy/user-management.md §2.3)
--
-- Email is globally unique per user (Constitution Article 3). The create
-- actions must resolve an existing user by email so they can ATTACH a new
-- membership (the collaborator primitive) instead of duplicating the auth user.
-- supabase-js has no get-user-by-email; this SECURITY DEFINER helper reads
-- auth.users. It is NOT granted to authenticated/anon — only the service-role
-- client (used inside the gated create actions) calls it.

create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

comment on function public.get_auth_user_id_by_email(text) is
  'Resolve an auth user id by email (case-insensitive) so create actions can attach memberships to an existing identity. Service-role only. Per docs/policy/user-management.md §2.3.';

revoke all on function public.get_auth_user_id_by_email(text) from public, authenticated, anon;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;
