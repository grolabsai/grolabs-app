-- Sliding-window rate-limit counters for /api/v1/search/token (and Stage 1's
-- /api/v1/search). Per docs/policy/search-foundations.md §6.
--
-- Bucket key encodes the dimension being limited:
--   "tok:inst=<id>:origin=<host>"  → 60/min cap (per-instance, per-origin)
--   "tok:ip=<addr>"                → 600/min cap (per-IP)
-- Stage 1 will add "search:..." buckets for the search proxy endpoint.
--
-- The check function does upsert-with-window-reset-and-increment in a single
-- statement under the row lock taken by ON CONFLICT, so it's safe under
-- concurrent calls.

create table public.search_rate_limit (
  bucket text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

comment on table public.search_rate_limit is
  'Sliding-window rate-limit counters for /api/v1/search/* endpoints. Per docs/policy/search-foundations.md.';

-- No app-level access; only the SECURITY DEFINER function below touches it.
alter table public.search_rate_limit enable row level security;

create or replace function public.search_rate_limit_check(
  p_bucket text,
  p_max int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count int;
begin
  insert into search_rate_limit as srl (bucket, window_start, count)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
    set window_start = case
      when srl.window_start < v_now - make_interval(secs => p_window_seconds)
        then v_now
      else srl.window_start
    end,
    count = case
      when srl.window_start < v_now - make_interval(secs => p_window_seconds)
        then 1
      else srl.count + 1
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

comment on function public.search_rate_limit_check(text, int, int) is
  'Atomically increments a sliding-window counter and returns true if the request is within the cap. Per docs/policy/search-foundations.md §6.';

revoke all on function public.search_rate_limit_check(text, int, int) from public;
grant execute on function public.search_rate_limit_check(text, int, int) to authenticated, service_role;
