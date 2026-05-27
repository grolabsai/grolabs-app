-- Storage bucket for diagnostic screenshot evidence (phase 2 of the
-- Browserless work). One PNG per finding, public-read because the
-- run_id UUID it lives under is already an unguessable share token
-- (same access model as the public report page itself).
--
-- Path convention: <run_id>/<check_code>.png — stable per (run, check)
-- so the runner can pre-compute the URL before insert (no
-- chicken-and-egg with finding_id).

insert into storage.buckets (id, name, public)
values ('prospect-evidence', 'prospect-evidence', true)
on conflict (id) do nothing;

-- Public can read anything in this bucket. Privacy is provided by the
-- run-UUID prefix (32 bytes of entropy = same as the run-share token).
drop policy if exists "Public read prospect-evidence"
  on storage.objects;
create policy "Public read prospect-evidence"
  on storage.objects for select
  using (bucket_id = 'prospect-evidence');

-- service_role bypasses RLS for INSERT/UPDATE/DELETE, so no write
-- policy needed. The runner uses the service-role client when writing
-- screenshots so anon-driven public diagnostics can also upload.
