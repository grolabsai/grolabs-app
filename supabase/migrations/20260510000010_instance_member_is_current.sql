-- Per docs/policy/instance-management.md (PR #67).
-- Adds `is_current` as the "currently-viewed instance" indicator, separate
-- from `is_active` ("user has access"). Lets a user have multiple active
-- memberships with exactly one current.
--
-- Without this column, every page that does
--   instance_member.select(...).eq('user_id', uid).eq('is_active', true).maybeSingle()
-- breaks the moment a user belongs to two active instances — .maybeSingle()
-- errors on multiple rows. Pages migrate to filtering on is_current=true.
--
-- A partial unique index enforces "at most one current per user" so the
-- ambiguity can't return at the data layer.
--
-- The current_instance_id() RPC (used by RLS) is updated to read is_current
-- so RLS-scoped queries also see the user's chosen instance.
--
-- This migration is the BACKEND half of the policy. The TopBar dropdown,
-- create-instance modal, and createInstance server action are still pending
-- (terminal 6 implementation PR).

alter table public.instance_member
  add column is_current boolean not null default false;

comment on column public.instance_member.is_current is
  'True for the membership the user is currently looking at in the UI. Exactly one per user, enforced by partial unique index. Per docs/policy/instance-management.md.';

-- Backfill: existing data has at most one is_active=true per user, so this
-- mapping is unambiguous. Users with zero active memberships (e.g. invited
-- but not yet accepted) get no current — same as their pre-migration state.
update public.instance_member
set is_current = true
where is_active = true;

-- Enforce: at most one current membership per user. Catches double-set bugs
-- in switchToInstance at the DB layer.
create unique index uq_instance_member_user_current
  on public.instance_member (user_id)
  where is_current = true;

-- Update the helper RPC to read is_current instead of is_active. Same callers,
-- same return shape, but a user with multiple active memberships now gets a
-- deterministic answer based on their explicit "current" choice rather than
-- an arbitrary order-by-instance_id pick.
create or replace function public.current_instance_id()
  returns bigint
  language sql
  stable
  security definer
  set search_path = public
as $$
  select instance_id
  from instance_member
  where user_id = auth.uid()
    and is_current = true
  limit 1;
$$;
