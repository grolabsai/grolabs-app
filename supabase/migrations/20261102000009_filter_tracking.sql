-- Record how shoppers NARROW, not just what they search.
--
-- Found 2026-11-02 answering "I don't see the events for when the user
-- navigates the catalog by categories or clicks the facets". They were not
-- there, and three separate things were missing rather than one:
--
--   1. GroLabs has no facet UI at all. FACET_ALLOWLIST and sanitizeFacets in
--      grolabs-search-core.js are dead code carried over from the proxy --
--      neither renderer ever passes facets or filter to search(), and the
--      results block renders a grid and a load-more button. So there is
--      nothing of ours for a shopper to click.
--   2. query_log had no filter column, so even when facets ARE passed, a
--      search narrowed to one brand and the same search unfiltered are the
--      same row differing only in total_hits, with nothing recording why.
--   3. The pixel did not subscribe to collection_viewed, so category browsing
--      was invisible.
--
-- Any filtering shoppers do today therefore happens in the merchant's own
-- theme and never reaches us. See docs/design/filter-and-category-tracking.md.
--
-- WHY JSONB AND NOT COLUMNS. A filter set is open: vendor, product type, tag,
-- availability, price range, any option name the merchant defined, and
-- metafield filters whose keys we cannot know in advance. Columns would be a
-- migration per merchant idea. query_log.variant_selection is the existing
-- precedent on this table for exactly this shape.
--
-- WHY TWO COLUMNS ON analytics_event. `filters` is the STATE after the change;
-- `filter_delta` is what moved. Deriving the delta from a series of states
-- requires that series to be complete, and browser-batched telemetry is
-- explicitly not loss-free (R-13 of direct-meilisearch-search.md) -- a dropped
-- state silently turns two changes into one. Recording the delta at the moment
-- it is known costs a few bytes and survives the loss.
--
-- DELIBERATELY NOT HERE: rollups. event-tracking.md §4a says not to expand
-- storage or rollups on analytics_event until DEC-1 (the event-store
-- substrate) is decided. Nullable columns are substrate-agnostic -- they
-- migrate with everything else -- while new metric_daily_source CTEs are
-- precisely the "more analysis built on top" that DEC-1 gates. Emission and
-- ingest land now so the data starts accumulating, which is the part that
-- takes weeks; filter_usage_rate lands when the substrate is settled.
--
-- Not backfilled: nothing before this carries a filter, because nothing ever
-- sent one.

alter table public.analytics_event
  add column if not exists filters      jsonb,
  add column if not exists filter_delta jsonb;

alter table public.query_log
  add column if not exists filters jsonb;

comment on column public.analytics_event.filters is
  'Normalised filter STATE in force when the event fired, e.g. {"vendor":["Burton"],"price":{"gte":100}}. Parsed from the storefront URL''s filter.* parameters, capped per docs/design/filter-and-category-tracking.md R-5. NULL means no filter was active OR the event predates 20261102000009 -- the two are not distinguishable, which is why no series should cross this date.';

comment on column public.analytics_event.filter_delta is
  'What changed, e.g. {"added":["vendor:Burton"],"removed":[]}. Recorded rather than derived: deriving it needs a complete state series and browser-batched telemetry is not loss-free. Set only on a Filters changed event.';

comment on column public.query_log.filters is
  'The filter state in force when this search ran. Lets a narrowed search be told apart from a repeat of the same query -- before this they were the same row with a different total_hits.';

-- "Which collections get filtered, and how hard" is the first question anyone
-- will ask of this, and it is a scan without an index on the filtered subset.
create index if not exists analytics_event_filters
  on public.analytics_event (instance_id, created_at)
  where filters is not null;
