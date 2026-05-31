-- Local store of click + conversion events the WP plugin emits.
--
-- Why this exists: Meilisearch Cloud's analytics dashboard is the
-- authoritative store for these events (the plugin POSTs there directly
-- with a tenant token), but Meilisearch's free/build tiers expose NO
-- programmatic read API — events can only be viewed via the cloud
-- dashboard UI. To surface events inside GroLabs's admin we need a local
-- copy, populated by the plugin via a parallel POST to /api/v1/events.
--
-- See docs/policy/search-events.md for the full flow.
--
-- Cardinality note: at merchant scale this table could grow large. For
-- v1 we keep ALL events; a retention/archival job is a future concern
-- (probably keep raw for 90d, then aggregate). No indexes-per-product
-- because the panel queries are always scoped to instance_id.

CREATE TABLE IF NOT EXISTS public.analytics_event (
  id            bigserial PRIMARY KEY,
  instance_id   bigint   NOT NULL REFERENCES public.instance(instance_id) ON DELETE CASCADE,
  -- 'click' or 'conversion'. text not enum because the set is small
  -- and stable; an enum migration when we add 'view' would be more
  -- friction than value.
  event_type    text     NOT NULL,
  -- Human-readable label that the plugin sends and Meilisearch's
  -- dashboard groups by. Stable strings — renaming one splits history.
  event_name    text     NOT NULL,
  -- Anonymous browser-session id (random UUID stored in localStorage by
  -- the plugin). Lets us trace a single visitor's funnel within their
  -- session; clears when they wipe storage. Never PII.
  user_id       text     NULL,
  -- The Meilisearch queryUid that surfaced the product. NULL for events
  -- without search lineage (shouldn't happen in v1 — plugin filters
  -- attribution-less conversions out client-side — but we accept NULL
  -- to be defensive).
  query_uid     text     NULL,
  -- Meilisearch index uid the original query ran against. Useful for
  -- cross-checking dashboard data; usually `scout-products-<instance_id>`.
  index_uid     text     NULL,
  -- Product identifier (WooCommerce id in our pipeline). text so we
  -- don't have to coerce — Meilisearch's analytics treats it as
  -- string anyway.
  object_id     text     NULL,
  object_name   text     NULL,
  -- Zero-indexed rank within the result set. NULL for events where
  -- position doesn't apply (e.g. 'Completed order' fires per cart
  -- item; the position the customer saw it at on the original SERP
  -- is preserved via attribution lookup, but if the attribution had
  -- no position we store NULL).
  position      smallint NULL,
  -- Originating storefront. The RRE endpoint validates this against
  -- instance.storefront_domains before inserting, so a row's presence
  -- here means the origin was authorized at write time.
  origin        text     NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Panel queries (recent N events, counts by event_name in last 24h) are
-- all scoped to instance_id and ordered by created_at DESC. One BRIN-ish
-- B-tree handles both shapes cheaply.
CREATE INDEX IF NOT EXISTS idx_analytics_event_instance_created
  ON public.analytics_event (instance_id, created_at DESC);

-- Attribution-chain queries (find all events for a given queryUid):
-- "show me everything that happened after the customer searched X".
CREATE INDEX IF NOT EXISTS idx_analytics_event_query_uid
  ON public.analytics_event (instance_id, query_uid)
  WHERE query_uid IS NOT NULL;

COMMENT ON TABLE public.analytics_event IS
  'Local mirror of click+conversion events the WP plugin posts to Meilisearch. '
  'Exists so GroLabs admin can surface event flow without an Enterprise-tier '
  'Meilisearch Cloud subscription. See docs/policy/search-events.md.';

ALTER TABLE public.analytics_event ENABLE ROW LEVEL SECURITY;

-- Reads: any authenticated user who is a member of the instance. The
-- pattern matches query_log's policy from migration 20260510000001 so
-- the same admin UI components can read both without surprises.
DROP POLICY IF EXISTS analytics_event_select ON public.analytics_event;
CREATE POLICY analytics_event_select
  ON public.analytics_event
  FOR SELECT
  TO authenticated
  USING (
    instance_id IN (
      SELECT im.instance_id FROM public.instance_member im
      WHERE im.user_id = auth.uid()
    )
  );

-- Writes: only service_role. The receiver endpoint at
-- POST /api/v1/events runs with the service-role client (no user JWT
-- since the storefront has no auth). RLS denies all other writers.

INSERT INTO public.scout_schema_version (version, description)
VALUES (
  '20260520000002',
  'Search events: analytics_event table for local mirror of plugin-emitted click/conversion events'
)
ON CONFLICT (version) DO NOTHING;
