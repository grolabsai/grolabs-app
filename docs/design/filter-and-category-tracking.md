---
application: core-app
module: Design
title: "Filter & category tracking — recording how shoppers narrow, not just what they search"
status: Draft
owner: "Tuncho"
scope: "What to code so GroLabs can answer: do shoppers use filters, do they browse by category, and what happens when they do. Covers where filtering actually occurs today (the merchant's theme, not ours), why the theme embed and not the pixel must observe it, the event and column shape, and what is deliberately deferred behind DEC-1."
audience: "Claude Code (implementer). Read after event-tracking.md (the store) and experimentation.md (what this evidence is for)."

actors:
  - name: Shopper
    type: human
    definition: Narrows a collection with the merchant theme's native filters, or browses by category. Does none of this through GroLabs UI today.
  - name: Theme embed
    type: plugin
    definition: grolabs-events.js, already loaded on every storefront page. Can see the DOM and the URL, and can hook history changes — which is why it, not the pixel, must own filter observation.
  - name: Web pixel
    type: plugin
    definition: Sandboxed worker. Sees Shopify's standard events but cannot see the DOM, theme settings, or a history.pushState the theme performs.
  - name: Measurement layer
    type: system
    definition: query_log + analytics_event + metric_daily. Receives the new signal; its rollups are gated on DEC-1.

integrations:
  - name: analytics_event
    kind: internal-module
    target: Own event store
    direction: in
    purpose: Receives the two new event names. Needs one new nullable column.
  - name: query_log
    kind: internal-module
    target: Search log
    direction: in
    purpose: Gains the filter state in force at the time of a search.
  - name: Shopify Web Pixels API
    kind: external-service
    target: shopify
    direction: in
    purpose: collection_viewed supplies the collection identity; it does NOT supply filter interactions.

rules:
  - id: R-1
    statement: "There is nothing to instrument in GroLabs' own UI, because GroLabs has no facet UI. FACET_ALLOWLIST and sanitizeFacets in grolabs-search-core.js are DEAD CODE carried over from the proxy — neither renderer ever passes facets or filter to search(), and the results block renders a grid and a load-more button and nothing else."
    truth: true
    rationale: "Verified 2026-11-02: zero occurrences of facet/refine/filter in grolabs-results.js, grolabs-search.css or search-results.liquid. Any filtering a shopper does today is the merchant theme's native collection filtering, which our code has never seen."
  - id: R-2
    statement: "The THEME EMBED must own filter observation, not the pixel. Shopify emits no filter event, and modern themes (Dawn and its descendants) apply filters by fetching a section and calling history.pushState/replaceState — no page load, so collection_viewed does not re-fire. The embed runs on the page, can patch history and listen to popstate, and therefore sees every filter change; the pixel sees only the ones that happen to involve a navigation."
    truth: true
    rationale: "This is the single decision that makes the feature work or silently under-report. Reading filters from the pixel looks correct and would miss most interactions on exactly the themes merchants actually run."
  - id: R-3
    statement: "Record BOTH the filter STATE and the filter TRANSITION. State is which filters are active on a listing view; transition is what was added or removed. They answer different questions and neither substitutes for the other."
    truth: true
    rationale: "State answers 'what share of listing views are filtered' and joins to outcomes. Transition answers 'how many filters did they try before giving up', which is the signal that a facet set is wrong. Deriving transitions from states requires a complete, loss-free state series, which browser-batched telemetry does not guarantee (R-13 of direct-meilisearch-search.md)."
  - id: R-4
    statement: "A filter change must NOT be fed into assignIntent. The reformulation classifier reasons over query TEXT; a facet narrowing and a term narrowing are different acts with different remedies, and collapsing them would make reformulation_type ambiguous exactly where it is used to prescribe a fix."
    truth: true
    rationale: "Tempting because a facet narrowing is conceptually 'narrowing'. But conversion-measurement-foundations.md maps narrowing to a faceting remedy — if the shopper already used a facet, that prescription is nonsense. Keep filter_delta a separate signal and revisit once there is data."
  - id: R-5
    statement: "Filter values are capped and allowlisted by PREFIX, not by value. Only parameters beginning `filter.` are read; at most 10 filters and 20 values per event; each key and value truncated to 64 characters; the whole object to 2KB."
    truth: true
    rationale: "Filter values are product attributes, not PII, so the risk is cardinality and payload size rather than privacy. A merchant with a metafield filter can produce arbitrarily long keys, and this rides a keepalive batch with a ~64KB ceiling."
  - id: R-6
    statement: "Emission and ingest land now; ROLLUPS wait for DEC-1. event-tracking.md §4a says not to expand storage or rollups on analytics_event until the substrate decision is made. One nullable column plus two event names is the minimum that is substrate-agnostic — the rows will migrate with everything else — whereas new metric_daily_source CTEs are exactly the 'more analysis built on top' DEC-1 exists to gate."
    truth: true
    rationale: "Lets the measurement start accumulating immediately, which matters because the question ('do they filter at all?') needs weeks of data before it can be answered, while the aggregation can be written in an afternoon once the substrate is settled. Measure first."
  - id: R-7
    statement: "No backend deploy is required to start receiving these. /api/v1/events accepts an unknown eventType deliberately — it warns and stores — so the storefront can ship ahead of the backend. The type is still added to KNOWN_EVENT_TYPES to silence the drift warning, which exists to catch exactly this."
    truth: true
    rationale: "Verified at route.ts: 'Accept it anyway — future event types should land cleanly without a RRE deploy'. Worth knowing, because it decouples the two releases."
  - id: R-8
    statement: "'Shoppers who filter buy more' is NOT what this instrumentation proves, and the doc that consumes it says so. This records usage and correlation; causality needs the intervention designs in experimentation.md."
    truth: true
    rationale: "Filter users self-select for intent. Stated here as well as there, because this is the data someone will reach for when making the claim."

useCases:
  - id: T-1
    title: A filter applied without a page load is still recorded
    given: A Dawn-based theme that filters by fetching a section and calling history.replaceState
    when: The shopper ticks a brand facet
    then: The embed's history hook fires, the filter state is re-read from the URL, and a Filters changed event is emitted — although collection_viewed never fired again
    verifies: [R-2]
  - id: T-2
    title: Filter usage rate becomes answerable
    given: Category viewed events carrying filter state
    when: A week of traffic accumulates
    then: filtered listing views ÷ listing views is computable per instance per day, which is the "do they use them at all" question
    verifies: [R-3, R-6]
  - id: T-3
    title: A facet narrowing does not corrupt the reformulation type
    given: A shopper who searches "snowboard" and then ticks a price facet
    when: The events are recorded
    then: query_log carries the filter state, reformulation_type is untouched, and no intent is told that a textual narrowing occurred
    verifies: [R-4]
  - id: T-4
    title: A metafield filter cannot blow the batch
    given: A merchant with long metafield-based filter keys and many selected values
    when: The shopper selects fifteen of them
    then: The event carries ten filters, truncated, within 2KB, and the batch still flushes
    verifies: [R-5]
---

# Filter & category tracking

Status: **Draft — nothing built.** Written 2026-11-02 in answer to "I don't see the
events for when the user navigates the catalog by categories or clicks the facets."

They are not there. Three facts, each verified rather than assumed:

1. **GroLabs has no facet UI.** `FACET_ALLOWLIST` and `sanitizeFacets` in
   `grolabs-search-core.js` are dead code from the proxy era; neither renderer ever passes
   `facets` or `filter` to `search()`. A GroLabs results page is a grid and a load-more.
2. **`query_log` has no filter column.** Even when facets are eventually passed, a search
   narrowed to one brand and the same search unfiltered are the same row, differing only in
   `total_hits`, with nothing recording why.
3. **The pixel does not subscribe to `collection_viewed`.** Category browsing is invisible.

So filtering *does* happen on these stores — in the merchant's own theme — and none of it
reaches us.

## 1. The decision that makes or breaks this

**The theme embed observes filters. Not the pixel.**

Shopify emits no filter event, so the only signal is the URL: native filters live in query
parameters (`filter.p.vendor`, `filter.v.option.*`, `filter.v.price.gte`,
`filter.v.availability`, `filter.p.m.*` for metafields). The obvious implementation is to
read them in the pixel on `collection_viewed`.

That implementation under-reports badly. Dawn and the themes derived from it apply a filter
by fetching a section and calling `history.replaceState` — **no page load, so
`collection_viewed` does not fire again.** The pixel would catch the first, navigation-based
filter and miss every subsequent refinement, which is precisely the behaviour we want to
measure.

`grolabs-events.js` already runs on every page, can patch `pushState`/`replaceState`, and
can listen for `popstate`. It sees all of them.

The pixel keeps `collection_viewed`, which is the one thing it supplies better: the
collection's identity and product count, without scraping the DOM.

## 2. What gets recorded

Two events, one new column, one new field on the search row.

| | `Category viewed` | `Filters changed` |
|---|---|---|
| `event_type` | `view` | `filter` (new) |
| Fires on | collection page view | any change to the `filter.*` params |
| Carries | collection handle + id, product count, **filter state** | **filter state** after, plus the delta |
| Emitter | pixel (`collection_viewed`) | theme embed (history hook) |

**Filter state** is a normalised object, not the raw query string:

```json
{ "vendor": ["Burton"], "option.size": ["154","157"], "price": { "gte": 100 } }
```

**Delta** names only what moved: `{"added":["vendor:Burton"],"removed":[]}`.

Both ride the existing batch queue, so they inherit `event_id`, `seq`, `age_ms` and the
retry behaviour with no new transport.

## 3. Code changes, file by file

**Storefront — `extensions/grolabs-storefront/assets/grolabs-events.js`**
- `readFilterState()` — parse `location.search` for `filter.` prefixed params into the
  normalised object; apply the R-5 caps.
- Hook `history.pushState` and `history.replaceState`, and listen for `popstate`. On each,
  re-read the state; if it differs from the last seen state for this path, emit
  `Filters changed` with the state and the delta. Debounce ~150 ms, because a theme can
  issue several history calls for one interaction.
- Keep the last state in memory per path, not in storage — it is per page view.

**Pixel — `extensions/grolabs-pixel/src/index.js`**
- `analytics.subscribe("collection_viewed", …)` → emit `Category viewed` with the collection
  handle/id, product count, and the filter state read from the event's own URL context.

**Receiver — `src/app/api/v1/events/route.ts`**
- Add `"filter"` to `KNOWN_EVENT_TYPES`. Not strictly required (R-7) — the route accepts
  unknown types on purpose — but it silences a drift warning that exists to catch real drift.

**Drain — `src/app/api/v1/events/drain/route.ts`**
- Carry `filters` (jsonb) and `filter_delta` (jsonb) onto `analytics_event`, and `filters`
  onto `query_log` for a search performed with filters active.

**Migration**
- `analytics_event`: `filters jsonb`, `filter_delta jsonb`, both nullable.
- `query_log`: `filters jsonb` — `variant_selection` is the existing jsonb precedent on this
  table.
- Comments on each, and a dated note that nothing before the migration carries them.

**Taxonomy**
- Add both names to `event-tracking.md` §2, and to the "everything recorded" card in
  `docs/state/event-semantics-trace.md`. The taxonomy drift that produced `Cart updated`
  (F-8) is what happens when this step is skipped.

## 4. What is deliberately NOT in this spec

- **No rollups.** `event-tracking.md` §4a says not to expand storage or rollups on
  `analytics_event` until **DEC-1** (the event-store substrate) is decided. One nullable
  column is substrate-agnostic — the rows migrate with everything else — but new
  `metric_daily_source` CTEs are exactly the "more analysis built on top" that DEC-1 gates.
  Emission and ingest now; `filter_usage_rate` when DEC-1 is settled. The data accumulates
  meanwhile, which is the part that takes weeks.
- **No feeding into `assignIntent`** (R-4). A facet narrowing is not a textual narrowing, and
  conflating them would make `reformulation_type` prescribe faceting to someone who just
  used a facet.
- **No GroLabs facet UI.** That is a feature. The point of this spec is to find out whether
  it is worth building before building it.
- **No causal claim.** This measures usage and correlation. "People who filter buy more" is
  self-selection; see `experimentation.md` R-7.

## 5. What it unblocks

- *Do shoppers use filters?* — filtered listing views ÷ listing views.
- *How hard do they work at it?* — filters per session, and the depth before abandonment.
- *Does it matter?* — correlation now; causality only via the switchback or staggered
  rollout in `experimentation.md`, which needs this instrumentation as its primary metric.
- *Is a GroLabs facet rail worth building?* — the first number answers this, and it costs no
  UI work to get.

---

**End — directional. Nothing built; §3 is the work.**
