-- Server-side Meilisearch health + canary probe.
--
-- Per docs/design/direct-meilisearch-search.md Phase 3 step 13. Now that the
-- storefront talks to Meilisearch directly, GroLabs sees NOTHING when search
-- breaks: no proxy request, no query_log row, no error. The shopper silently
-- gets native results and we find out from the merchant. This probe is how we
-- find out first -- detection for US, never for the shopper (R-19 still bars
-- a /health pre-flight from the storefront's own path).
--
-- Why in the database rather than a scheduled route handler: the failure we
-- most need to detect is the app being down, and a probe hosted by the app
-- cannot report on that. The cost is pg_net -- the database gains the ability
-- to make outbound HTTP requests, which is a real security surface. That is
-- logged as SEC-002 in docs/backlog/items/, deliberately, rather than being
-- left as a comment nobody reads.
--
-- pg_net is ASYNCHRONOUS: net.http_* queues a request and returns an id
-- immediately; a background worker performs it and writes the response to
-- net._http_response. So a probe is necessarily two steps -- fire, then
-- collect on a later tick -- and search_probe correlates the two.
--
-- A probe that silently stops is worse than no probe, which is the same class
-- of failure this whole design exists to avoid. So the collector also ages out
-- requests that never came back (a wedged pg_net worker) and records them as
-- failures, rather than leaving them pending forever and looking healthy.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Config
-- ---------------------------------------------------------------------------
-- One row. The Meilisearch host is an app-side env var, and the database has
-- no access to it, so the probe needs its own copy. Kept as a table rather
-- than a GUC so it is queryable and obvious to whoever finds this later.
create table if not exists public.search_probe_config (
  singleton        boolean primary key default true check (singleton),
  meilisearch_host text    not null,
  enabled          boolean not null default true,
  -- Requests older than this with no response mean the pg_net worker is stuck.
  stale_after      interval not null default '10 minutes',
  updated_at       timestamptz not null default now()
);

alter table public.search_probe_config enable row level security;

comment on table public.search_probe_config is
  'Single-row config for the Meilisearch health/canary probe. Deny-all RLS; read only by the cron functions.';

-- ---------------------------------------------------------------------------
-- 2. In-flight probe correlation
-- ---------------------------------------------------------------------------
create table if not exists public.search_probe (
  search_probe_id bigserial primary key,
  request_id      bigint not null,
  instance_id     bigint references public.instance(instance_id) on delete cascade,
  kind            text   not null check (kind in ('health', 'canary')),
  index_uid       text,
  sent_at         timestamptz not null default now(),
  collected_at    timestamptz
);

create unique index if not exists search_probe_request_id on public.search_probe (request_id);
-- The collector only ever scans what is still outstanding.
create index if not exists search_probe_pending
  on public.search_probe (sent_at) where collected_at is null;

alter table public.search_probe enable row level security;

comment on table public.search_probe is
  'Correlates a pg_net request id with what it was probing, because pg_net responses arrive on a later tick. Rows are retired by search_probe_collect().';

-- ---------------------------------------------------------------------------
-- 3. Collect
-- ---------------------------------------------------------------------------
-- Drains whatever pg_net has finished since the last tick into
-- backend_operation, then fails anything too old to still be coming.
create or replace function public.search_probe_collect()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_stale   interval;
  v_count   integer := 0;
begin
  select stale_after into v_stale from public.search_probe_config where singleton;
  v_stale := coalesce(v_stale, interval '10 minutes');

  -- Responses that came back.
  with done as (
    select p.search_probe_id,
           p.instance_id,
           p.kind,
           p.index_uid,
           p.sent_at,
           r.status_code,
           r.timed_out,
           r.error_msg,
           -- when the response actually landed, NOT when we collected it
           r.created as responded_at
    from public.search_probe p
    join net._http_response r on r.id = p.request_id
    where p.collected_at is null
  ), logged as (
    insert into public.backend_operation (
      instance_id, operation_type, target_id, payload_summary,
      status, response_payload, error_message, started_at, completed_at, duration_ms
    )
    select
      -- backend_operation.instance_id is NOT NULL and a cluster-wide health
      -- check belongs to no tenant. Instance 0 is GroLabs' own system
      -- instance, which is where cluster-level operations belong.
      coalesce(d.instance_id, 0),
      'search_probe_' || d.kind,
      coalesce(d.index_uid, 'meilisearch'),
      jsonb_build_object('kind', d.kind, 'index_uid', d.index_uid),
      case when d.status_code between 200 and 299 then 'succeeded' else 'failed' end,
      -- Status only. The response body can carry catalog rows, and this table
      -- is read by humans debugging unrelated things.
      jsonb_build_object('status_code', d.status_code, 'timed_out', coalesce(d.timed_out, false)),
      case when d.status_code between 200 and 299 then null
           else coalesce(d.error_msg, 'http ' || coalesce(d.status_code::text, 'none')) end,
      d.sent_at,
      -- pg_net is async, so 'now()' here is whenever the collector happened to
      -- run -- up to a full cron interval later. Logging that as latency would
      -- have someone investigating a 60s search that answered in 7ms.
      -- net._http_response.created is when the response actually landed.
      coalesce(d.responded_at, now()),
      greatest(0, (extract(epoch from (coalesce(d.responded_at, now()) - d.sent_at)) * 1000)::int)
    from done d
    returning 1
  )
  select count(*) into v_count from logged;

  update public.search_probe p
     set collected_at = now()
   where p.collected_at is null
     and exists (select 1 from net._http_response r where r.id = p.request_id);

  -- Never came back at all. A stuck worker must look like a failure, not like
  -- silence -- silence is indistinguishable from healthy.
  insert into public.backend_operation (
    instance_id, operation_type, target_id, payload_summary,
    status, error_message, started_at, completed_at, duration_ms
  )
  select coalesce(p.instance_id, 0),
         'search_probe_' || p.kind,
         coalesce(p.index_uid, 'meilisearch'),
         jsonb_build_object('kind', p.kind, 'index_uid', p.index_uid, 'stalled', true),
         'failed',
         'no pg_net response after ' || v_stale || ' (worker stalled?)',
         p.sent_at,
         now(),
         greatest(0, (extract(epoch from (now() - p.sent_at)) * 1000)::int)
    from public.search_probe p
   where p.collected_at is null
     and p.sent_at < now() - v_stale;

  update public.search_probe
     set collected_at = now()
   where collected_at is null
     and sent_at < now() - v_stale;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fire
-- ---------------------------------------------------------------------------
-- One /health for the cluster, plus one canary search per instance that holds
-- a live key -- using THAT INSTANCE'S OWN KEY, so the probe exercises exactly
-- the credential the storefront uses. A key revoked by accident shows up here
-- as a 403 instead of as a merchant complaint.
create or replace function public.search_probe_fire()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_host text;
  v_on   boolean;
  v_req  bigint;
  v_n    integer := 0;
  r      record;
begin
  select meilisearch_host, enabled into v_host, v_on
    from public.search_probe_config where singleton;
  if v_host is null or v_on is not true then
    return 0;
  end if;
  v_host := rtrim(v_host, '/');

  v_req := net.http_get(url := v_host || '/health', timeout_milliseconds := 5000);
  insert into public.search_probe (request_id, instance_id, kind, index_uid)
  values (v_req, null, 'health', null);
  v_n := v_n + 1;

  for r in
    select k.instance_id, k.key_value, 'inst_' || k.instance_id::text as index_uid
      from public.search_key k
      join public.instance i on i.instance_id = k.instance_id
     where k.revoked_at is null
       and i.is_active
  loop
    v_req := net.http_post(
      url     := v_host || '/indexes/' || r.index_uid || '/search',
      body    := jsonb_build_object('q', '', 'limit', 1),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || r.key_value),
      timeout_milliseconds := 5000
    );
    insert into public.search_probe (request_id, instance_id, kind, index_uid)
    values (v_req, r.instance_id, 'canary', r.index_uid);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tick
-- ---------------------------------------------------------------------------
-- Collect first, then fire: one job, and a tick that is skipped for any reason
-- self-heals on the next one.
create or replace function public.search_probe_tick()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.search_probe_collect();
  perform public.search_probe_fire();
end;
$$;

-- These run as cron, never as a tenant. Nothing in the API roles may call them.
revoke all on function public.search_probe_collect() from public, anon, authenticated;
revoke all on function public.search_probe_fire()    from public, anon, authenticated;
revoke all on function public.search_probe_tick()    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Schedule
-- ---------------------------------------------------------------------------
-- Every 5 minutes. Meilisearch answers in single-digit milliseconds, so this
-- is about noticing an outage promptly, not about load.
select cron.unschedule('search-probe') where exists (
  select 1 from cron.job where jobname = 'search-probe'
);
select cron.schedule('search-probe', '*/5 * * * *', 'select public.search_probe_tick();');
