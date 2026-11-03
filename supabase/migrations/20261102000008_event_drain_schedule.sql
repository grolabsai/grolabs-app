-- Schedule the drain from inside Postgres, because Vercel refused to (F-3).
--
-- Background. In direct mode the storefront no longer calls GroLabs to search,
-- so a search reaches query_log only by being reported afterwards and then
-- drained (R-10). Nothing was invoking /api/v1/events/drain: reported telemetry
-- accumulated safely in event_inbox and lost nothing, but reached query_log
-- only when someone called the endpoint by hand.
--
-- The obvious fix was a Vercel cron, and it was tried twice:
--
--   */5  * * * *   rejected at deploy -- the whole vercel.json refused
--   */10 * * * *   same shape, same outcome expected
--
-- This project is on a plan that allows two cron jobs at DAILY granularity.
-- One (ga4/poll, 0 6 * * *) is already spent, and a once-a-day drain would
-- mean telemetry up to 24 hours stale, which is not a monitoring tool anyone
-- would act on. So the schedule lives here instead, which is the repo's own
-- existing answer: search_probe_tick already runs every 5 minutes on pg_cron
-- and reaches outside through pg_net.
--
-- Why not move the drain logic itself into plpgsql. It needs assignIntent,
-- which is TypeScript, and that heuristic is explicitly designed to be swapped
-- later -- two copies would drift the first time anyone improved it. So the
-- function below does not drain; it RINGS THE DOORBELL, and the route does the
-- work. The route's own authorization contract is unchanged.
--
-- After R-33 (event time carried as an age) a late drain delays availability
-- rather than corrupting history, so the interval is a latency choice, not a
-- correctness one. Five minutes matches search_probe and is well inside the
-- route's maxDuration at the default batch size.

-- ---------------------------------------------------------------------------
-- 1. Config
-- ---------------------------------------------------------------------------
-- Singleton, exactly like search_probe_config. Deny-all RLS and no policies:
-- the only readers are the SECURITY DEFINER function below and service_role.
-- The cron secret sits here in plaintext, the same deliberate trade as
-- search_key.key_value -- a secret that must be PRESENTED cannot be hashed.
-- It is the same shared secret the route already accepts; holding it here adds
-- no new authority, only a new copy, and the copy is unreachable through
-- PostgREST.
create table if not exists public.event_drain_config (
  singleton    boolean primary key default true check (singleton),
  -- No trailing slash; the function strips one anyway.
  app_base_url text    not null,
  cron_secret  text    not null,
  enabled      boolean not null default true,
  -- Rows per run. The route's own default is 500 and its ceiling 2000.
  batch_limit  integer not null default 500 check (batch_limit between 1 and 2000),
  -- A fire with no response after this long means the pg_net worker is stuck,
  -- not that the drain is slow.
  stale_after  interval not null default '10 minutes',
  updated_at   timestamptz not null default now()
);

alter table public.event_drain_config enable row level security;

comment on table public.event_drain_config is
  'Single-row config for the pg_cron event drain. Deny-all RLS; read only by event_drain_tick(). Holds the same CRON_SECRET the route already accepts -- see the migration header for why it is plaintext.';

-- ---------------------------------------------------------------------------
-- 2. In-flight correlation
-- ---------------------------------------------------------------------------
-- pg_net is asynchronous: http_get returns a request id and the response lands
-- on a later tick. Without this table a fire that never came back would be
-- invisible -- and "the drain silently stopped running" is precisely the
-- failure this migration exists to prevent, so it must not be able to happen
-- quietly in the new mechanism either.
create table if not exists public.event_drain_call (
  event_drain_call_id bigserial primary key,
  request_id          bigint not null,
  sent_at             timestamptz not null default now(),
  collected_at        timestamptz
);

create unique index if not exists event_drain_call_request_id
  on public.event_drain_call (request_id);
create index if not exists event_drain_call_pending
  on public.event_drain_call (sent_at) where collected_at is null;

alter table public.event_drain_call enable row level security;

comment on table public.event_drain_call is
  'Correlates a pg_net request id with the drain call that issued it, because pg_net responses arrive on a later tick. Retired by event_drain_collect().';

-- ---------------------------------------------------------------------------
-- 3. Collect
-- ---------------------------------------------------------------------------
-- Only FAILURES are logged to backend_operation here. A successful drain
-- already writes its own row from inside the route, where the real counts are
-- known; logging it again would double-count every run. What the route cannot
-- log is a call that never reached it, and that is exactly what this records.
create or replace function public.event_drain_collect()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_stale interval;
  v_count integer := 0;
begin
  select stale_after into v_stale from public.event_drain_config where singleton;
  v_stale := coalesce(v_stale, interval '10 minutes');

  -- Responses that came back.
  with done as (
    select c.event_drain_call_id,
           c.sent_at,
           r.status_code,
           r.timed_out,
           r.error_msg,
           r.content,
           -- When the response actually landed, not when we got round to
           -- collecting it -- otherwise duration_ms measures our tick
           -- interval. (Learned the hard way on search_probe.)
           r.created as responded_at
    from public.event_drain_call c
    join net._http_response r on r.id = c.request_id
    where c.collected_at is null
  ), logged as (
    insert into public.backend_operation (
      instance_id, operation_type, target_id, payload_summary,
      status, error_message, started_at, completed_at, duration_ms
    )
    select
      -- backend_operation.instance_id is NOT NULL and the drain spans every
      -- tenant. Instance 0 is GroLabs' own system instance, which is where
      -- cluster-level operations belong.
      0,
      'event_drain_call',
      'pg_cron',
      jsonb_build_object(
        'status_code', d.status_code,
        'timed_out', d.timed_out,
        'body', left(coalesce(d.content, ''), 500)
      ),
      'failed',
      coalesce(
        d.error_msg,
        'drain call returned HTTP ' || coalesce(d.status_code::text, 'none')
      ),
      d.sent_at,
      d.responded_at,
      greatest(0, (extract(epoch from (d.responded_at - d.sent_at)) * 1000)::integer)
    from done d
    where d.status_code is null
       or d.status_code < 200
       or d.status_code >= 300
       or d.timed_out
    returning 1
  ), retired as (
    update public.event_drain_call c
       set collected_at = now()
      from done d
     where c.event_drain_call_id = d.event_drain_call_id
    returning 1
  )
  select count(*)::integer into v_count from retired;

  -- Fires with no response at all after stale_after: pg_net itself is stuck,
  -- which no amount of waiting fixes and nothing else would ever report.
  insert into public.backend_operation (
    instance_id, operation_type, target_id, status, error_message, started_at
  )
  select 0, 'event_drain_call', 'pg_cron', 'failed',
         'no pg_net response after ' || v_stale::text, c.sent_at
    from public.event_drain_call c
   where c.collected_at is null
     and c.sent_at < now() - v_stale;

  update public.event_drain_call
     set collected_at = now()
   where collected_at is null
     and sent_at < now() - v_stale;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fire
-- ---------------------------------------------------------------------------
create or replace function public.event_drain_fire()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
  v_on     boolean;
  v_limit  integer;
  v_req    bigint;
begin
  select rtrim(app_base_url, '/'), cron_secret, enabled, batch_limit
    into v_url, v_secret, v_on, v_limit
    from public.event_drain_config where singleton;

  if v_url is null or v_on is not true then
    return null;
  end if;

  -- Fire and forget. The route answers in its own time and logs its own
  -- outcome; all we keep is the request id, so a call that never lands can
  -- still be reported by event_drain_collect().
  v_req := net.http_get(
    url     := v_url || '/api/v1/events/drain?limit=' || v_limit::text,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    -- Generous: the route may be moving a backlog, and a timeout here would
    -- be logged as a failure for work that actually succeeded.
    timeout_milliseconds := 60000
  );

  insert into public.event_drain_call (request_id) values (v_req);
  return v_req;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tick
-- ---------------------------------------------------------------------------
-- Collect first, then fire -- one job, and a tick skipped for any reason
-- self-heals on the next one. Same shape as search_probe_tick.
create or replace function public.event_drain_tick()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.event_drain_collect();
  perform public.event_drain_fire();
end;
$$;

-- These are cron entry points, not an API. Nothing in the app calls them.
revoke all on function public.event_drain_collect() from public;
revoke all on function public.event_drain_fire()    from public;
revoke all on function public.event_drain_tick()    from public;

comment on function public.event_drain_tick() is
  'pg_cron entry point for the event drain: collect the previous fire''s outcome, then ring /api/v1/events/drain. Scheduled every 5 minutes as job "event-drain". Config in event_drain_config; nothing happens until app_base_url and cron_secret are set.';

-- ---------------------------------------------------------------------------
-- 6. Schedule
-- ---------------------------------------------------------------------------
-- Idempotent: unschedule first so re-running the migration does not leave two
-- jobs racing each other over the same inbox.
select cron.unschedule('event-drain') where exists (
  select 1 from cron.job where jobname = 'event-drain'
);
select cron.schedule('event-drain', '*/5 * * * *', 'select public.event_drain_tick();');
