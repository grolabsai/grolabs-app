-- Measuring how much storefront telemetry we lose (R-14).
--
-- Per docs/design/direct-meilisearch-search.md Phase 5 step 17 — but NOT the
-- way that step describes, and the reason matters.
--
-- The plan said: dual-report every committed search by both paths (direct
-- batch + the old proxy) and read the delta as the browser-loss ratio. That
-- cannot be done without corrupting the thing it is meant to protect:
--
--   1. metric_daily_source counts committed searches as ROWS IN query_log
--      (`where is_committed is not false`). A second row per search doubles
--      every search-volume KPI for the whole rollout window, and
--      refresh_metric_daily materialises it nightly.
--   2. Attribution is by query_uid ALONE. The proxy performs its own
--      Meilisearch search and mints its own query_uid, so its row can never
--      match the clicks belonging to the browser's search. Every dual-reported
--      search would look like a search nobody clicked, depressing CTR while
--      inflating volume.
--
-- So fidelity is measured by SEQUENCE instead. The storefront stamps every
-- event with a per-session counter; a gap in that counter is a lost event,
-- exactly and cheaply, with no second search, no second query_log row and no
-- effect on any KPI. It also covers every event type rather than just
-- committed searches.
--
-- Honest limitation, the same one dual-reporting had: loss at the TAIL of a
-- session is invisible (there is no later event to reveal the gap), and a
-- session that delivered nothing at all is invisible entirely. This measures
-- the loss that batching introduces, which is the new risk. It cannot measure
-- what never arrived by any path — nothing client-side can, now that the
-- server-observed truth is gone.

alter table public.event_inbox add column if not exists seq        integer;
alter table public.event_inbox add column if not exists session_id text;

comment on column public.event_inbox.seq is
  'Per-session monotonic counter stamped by the storefront. A gap between delivered seq values is a lost event (R-14).';
comment on column public.event_inbox.session_id is
  'The storefront session the seq counts within. Same id as query_log.user_id / analytics_event.user_id.';

create index if not exists event_inbox_session_seq
  on public.event_inbox (instance_id, session_id, seq)
  where session_id is not null;

-- Per-session delivery record. `missing` counts gaps INSIDE the delivered
-- range only, which is the honest number — see the tail caveat above.
create or replace view public.telemetry_fidelity as
  select
    instance_id,
    session_id,
    count(*)                                   as delivered,
    min(seq)                                   as first_seq,
    max(seq)                                   as last_seq,
    greatest(0, (max(seq) - min(seq) + 1) - count(*)) as missing,
    min(received_at)                           as first_seen,
    max(received_at)                           as last_seen
  from public.event_inbox
  where session_id is not null and seq is not null
  group by instance_id, session_id;

comment on view public.telemetry_fidelity is
  'Per-session telemetry delivery. missing = gaps within the delivered seq range; loss at the tail of a session is not observable. Roll up as sum(missing)/sum(delivered+missing) for an instance browser-loss ratio (R-14).';
