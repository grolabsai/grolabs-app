-- Attempt to narrow pg_net's default grants. KEPT DELIBERATELY EVEN THOUGH IT
-- DOES NOTHING, because what it fails to do is the finding.
--
-- `create extension pg_net` (20261102000002) leaves EXECUTE on net.http_get /
-- net.http_post granted to PUBLIC, which includes `anon` and `authenticated`.
-- Nothing of ours needs that: search_probe_fire() is SECURITY DEFINER and
-- reaches `net` as its owner.
--
-- Both statements below run WITHOUT ERROR and change nothing. Schema `net` is
-- owned by `supabase_admin`; migrations run as `postgres`, which is not a
-- member of it, and Postgres silently no-ops a REVOKE issued by someone who is
-- neither the grantor nor the owner. Verified after running:
--
--   select has_function_privilege('anon', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE');
--   -- still true
--
-- The lesson generalises beyond pg_net: in this project a REVOKE that did not
-- raise is not evidence of anything. Check the privilege afterwards.
--
-- Closing this needs supabase_admin (support or dashboard), and is tracked as
-- SEC-002 in docs/backlog/items/SEC-002.md with the full close-out steps. The
-- statements stay here so that a fresh environment where postgres DOES own the
-- schema gets the hardening for free, and so the next person does not spend the
-- same hour discovering the no-op.

revoke execute on all functions in schema net from public;
revoke all     on all tables    in schema net from public;
revoke usage   on schema net                  from public;

revoke execute on all functions in schema net from anon, authenticated;
revoke all     on all tables    in schema net from anon, authenticated;
revoke usage   on schema net                  from anon, authenticated;
