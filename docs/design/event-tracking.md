---
application: core-app
module: Design
title: "Event Tracking — the GroLabs-owned tracking store"
status: Draft
owner: "Tuncho"
audience: "Claude Code (implementer), GroLabs contributors working on storefront events, identity, or the measurement layer."
scope: "The GroLabs-owned behavioral-event tracking store: the WP plugin emission layer, the analytics_event + query_log schema, identity (anonymous browser id + Option B account_id), and the gating rules. This is the un-gated, journey-oriented sibling of the locked search-events.md (which owns the Meilisearch relevance-feedback subset). The KPI grammar (conversion-measurement-foundations.md) and findings (unified-findings-and-monitoring.md) READ this store; this doc OWNS emission + storage + identity. Directional/early — not locked policy."

actors:
  - name: WP storefront plugin
    type: plugin
    definition: grolabs-wordpress-search (v0.9.0+). Emits search, click, and conversion events; mints the persistent anonymous browser id; stamps the opaque account_id when the shopper is logged in; threads cart_id/order_id for journeys. Dual-writes (Meilisearch + own store).
  - name: RRE search proxy + event receiver
    type: system
    definition: /api/v1/search logs every query to query_log (now with is_committed + account_id); /api/v1/events receives the own-store mirror and writes analytics_event (now un-gated, with account_id + cart_id + order_id).
  - name: Meilisearch
    type: integration
    definition: Relevance-training consumer. Receives ONLY queryUid-attributed click/conversion events (the fence). Owned by search-events.md; unchanged by this doc.
  - name: Measurement / findings layer
    type: system
    definition: conversion-measurement-foundations.md (KPI grammar) and unified-findings-and-monitoring.md (findings). Read this store; never write it.

integrations:
  - name: query_log
    kind: internal-module
    target: Search proxy log
    direction: both
    purpose: Search half of the precise spine. Carries query, total_hits, query_uid, user_id (browser id), intent_group_id, and now is_committed / commit_reason / account_id.
  - name: analytics_event
    kind: internal-module
    target: Own event store (mirror of plugin emissions)
    direction: in
    purpose: Click + conversion + cart-remove atoms. Soft-joins to query_log on (instance_id, query_uid) and to itself on user_id / account_id / cart_id for journeys.
  - name: Meilisearch /events
    kind: external-service
    target: meilisearch
    direction: out
    purpose: Gated relevance feedback (queryUid-attributed only). See search-events.md.
  - name: ga4_*_daily
    kind: internal-module
    target: GA4 integration
    direction: in
    purpose: The anonymous daily-aggregate overlay tier — a sibling tracking source, never joined per-user. See ga4-integration.md.

rules:
  - id: R-1
    statement: "The fence is the routing rule. Meilisearch gets ONLY queryUid-attributed click/conversion events (it trains ranking). The own store (analytics_event) gets EVERYTHING, un-gated, with identity + journey keys. The two writes are independent; one producer, two consumers, two gates."
    truth: true
    rationale: "Implemented in events.js submitEvent: Meili write is conditional on payload.queryUid; the Scout write always fires. Keeps ranking feedback clean while giving the own store full journey coverage."
  - id: R-2
    statement: "Commitment is marked at capture time by the caller. The results-page (PHP) search sends committed=true (commit_reason=results_page); the typeahead (JS) sends committed=false (commit_reason=typeahead). query_log.is_committed lets search-quality KPIs exclude prefix probes. NULL = pre-migration/unknown."
    truth: true
    rationale: "The typeahead fires the logged /api/v1/search on every debounced keystroke, so query_log mixes probes with real searches; the caller is the only place commitment is unambiguous."
  - id: R-3
    statement: "Identity is Option B at device tier. user_id = persistent anonymous BROWSER id (localStorage, NOT a session). account_id = opaque SHA-256 over (instance_id, WC user id) — never raw, never PII — stamped when logged in. Login is the merge point; cross-device resolution is deferred."
    truth: true
    rationale: "current_account_id() in the plugin; shared by the results-page search, the typeahead, and the event tracker so one human in one browser stitches across surfaces."
  - id: R-4
    statement: "Recorded click position is the GLOBAL 0-based rank (offset + page index), not page-relative. parse_response() now seeds position from the page offset, so 'average click position' is meaningful across paginated results."
    truth: true
    rationale: "Previously position reset to 0 each page, biasing the average toward 0. Old rows remain page-relative (un-backfillable); the discontinuity is dated to v0.9.0."
  - id: R-5
    statement: "Journey keys live only on the own store. analytics_event carries account_id (human), cart_id (WC session thread add→checkout→order), order_id (purchase grain). They are NEVER sent to Meilisearch — its event schema is untouched."
    truth: true
    rationale: "events.js attaches account_id/cart_id/order_id to the Scout body only; commonBody (the Meili-safe shape) excludes them."
  - id: R-6
    statement: "cart_id / order_id / source pre-existed on the live analytics_event as UNTRACKED drift (no migration file, no scout_schema_version row — likely the BYO/SDK work, the SDK README's never-sent journey keys). Migration 20260627000002 reconciles them into version control (Art. 10). source is left unpopulated until its originating work is consulted."
    truth: true
    rationale: "Discovered 2026-06-27 by inspecting the live scout DB vs the migration files. Repo is the source of truth; drift is reconciled, not ignored."
  - id: R-7
    statement: "Un-gated firing is the search-events.md amendment, now landing on the OWN-STORE side. Conversions (add/checkout/order) and the new remove-from-cart write to analytics_event regardless of search lineage; the Meilisearch path stays attribution-gated. search-events.md keeps a dated pointer here; its non-goals re: best-effort-loss + no-aggregation are superseded for the own store only."
    truth: true
    rationale: "Resolves the locked-doc tension by fencing the un-gated concern into this Draft doc. The Meilisearch statements in search-events.md remain true."

useCases:
  - id: T-1
    title: A direct-nav add-to-cart is now tracked
    given: A shopper reaches a PDP without searching and adds to cart
    when: events.js fires the conversion
    then: It lands in analytics_event (Scout) with account_id/cart_id but no queryUid, so the journey is captured; the Meilisearch write is skipped (no attribution) — the fence holds
    verifies: [R-1, R-5]
  - id: T-2
    title: Typeahead probes are separable from committed searches
    given: A shopper types "do" then "dog" then hits Enter
    when: The typeahead logs probes (committed=false) and the results page logs the committed search (committed=true)
    then: Search-quality KPIs read only is_committed=true rows, excluding the prefix noise
    verifies: [R-2]
  - id: T-3
    title: Cart value is computable
    given: A shopper adds two items, removes one, buys one
    when: events.js emits two adds, one cart_remove, one order
    then: analytics_event holds all four (un-gated); cart value = adds − removes − purchases is computable
    verifies: [R-1, R-5]
---

# Event Tracking — the GroLabs-owned tracking store

Status: **Directional / early.** NOT locked policy. This doc owns the GroLabs-owned event tracking
**store** — emission, storage, identity, gating. Its locked sibling
[`search-events.md`](../policy/search-events.md) owns the **Meilisearch relevance-feedback** subset.
Together with the [GA4 overlay](../policy/ga4-integration.md) they constitute "tracking." The KPI
grammar ([`conversion-measurement-foundations.md`](conversion-measurement-foundations.md)) and the
findings store ([`unified-findings-and-monitoring.md`](unified-findings-and-monitoring.md)) **read**
this store.

Owner: Tuncho · Date: 2026-06-27 · Plugin: `grolabs-wordpress-search` **v0.9.0**

> **What landed in v0.9.0 (this session).** Committed-search marking, global click position, Option B
> `account_id`, un-gated journey firing + `remove-from-cart`, journey keys (`cart_id`/`order_id`)
> populated, and a drift reconciliation of `cart_id`/`order_id`/`source`. Migrations
> `20260627000001` (query_log) + `20260627000002` (analytics_event) applied + verified. The KPI
> derivation layer (rollups, metric registry) is **next**, not in this pass.

---

## 1. Flow — one producer, two gated consumers

```mermaid
flowchart TD
  subgraph Producer["WP plugin (grolabs-wordpress-search v0.9.0)"]
    TA["typeahead.js<br/>prefix probes (committed=false)"]
    EV["events.js<br/>click / add / checkout / order / remove"]
    PHP["results page (PHP)<br/>committed search (committed=true)"]
  end
  PHP -->|"POST /api/v1/search<br/>committed, account_id"| QL["query_log<br/>(+ is_committed, commit_reason, account_id)"]
  TA -->|"POST /api/v1/search<br/>committed=false, account_id"| QL
  EV -->|"queryUid-attributed only"| MEILI["Meilisearch /events<br/>(ranking feedback — FENCED)"]
  EV -->|"ALL events, un-gated<br/>account_id, cart_id, order_id"| AE["analytics_event<br/>(own store)"]
  QL -. "soft-join (instance_id, query_uid)" .- AE
  AE --> READ["read by:<br/>conversion-measurement-foundations.md (KPIs)<br/>unified-findings-and-monitoring.md (findings)"]
  QL --> READ
```

## 2. Event taxonomy

| Event | eventType | Destinations | Keys carried |
|---|---|---|---|
| Search Performed | — (query_log row) | query_log | query, total_hits, query_uid, user_id, **is_committed**, commit_reason, **account_id**, intent_group_id |
| Search Result Clicked | `click` | Meili + own store | queryUid, **position (global)**, object_id, user_id, account_id |
| Added to cart | `conversion` | own store always; Meili iff attributed | object_id, user_id, account_id, cart_id, **placement** (pdp/plp/search_results/related/heading…), queryUid? position? |
| Proceeded to checkout | `conversion` | own store always; Meili iff attributed | object_id, account_id, cart_id, queryUid? |
| Completed order | `conversion` | own store always; Meili iff attributed | object_id, account_id, cart_id, **order_id**, queryUid? |
| Removed from cart | `cart_remove` | **own store only** | object_id, user_id, account_id, cart_id |

"Meili iff attributed" = the Meilisearch write fires only when a `queryUid` attribution exists for
that product (the fence — R-1). The own-store write always fires.

## 3. Identity (Option B, device tier)

- **`user_id`** — the persistent anonymous **browser id** (random UUID in `localStorage` key
  `grolabs_wordpress_search_session_id`; persistent per-browser, **NOT** a session). Best-effort,
  device-scoped.
- **`account_id`** — opaque **SHA-256 over (instance_id, WC user id)**, stamped when the shopper is
  logged in. Never the raw WC id, never PII. The only handle that means a human across devices.
  Computed once in `Grolabs_WordPress_Search::current_account_id()` and shared by the results-page
  search, the typeahead, and the event tracker so all three stamp the **same** value.
- **Login = merge point.** When `account_id` first appears for a browser id, the prior anonymous
  history attaches to the human (at device tier). The full identity-resolution graph is **deferred**.

## 4. Data model (ERD)

Bold tables: **query_log**, **analytics_event**. Soft joins (logical, not FK-enforced) carry the
spine. The GA4 overlay is a sibling source, never joined per-user.

```mermaid
erDiagram
  instance ||--o{ query_log : has
  instance ||--o{ analytics_event : has
  query_log ||..o{ analytics_event : "soft (instance_id, query_uid)"
  analytics_event ||..o{ analytics_event : "soft user_id / account_id / cart_id (journey)"
  query_log ||..o{ query_log : "soft (instance_id, user_id, intent_group_id)"

  query_log {
    bigserial id PK
    bigint instance_id FK
    text query
    integer total_hits
    text query_uid "soft FK -> analytics_event"
    text user_id "anon browser id"
    text intent_group_id
    boolean is_committed "v0.9.0 — true=committed, false=typeahead probe"
    text commit_reason "results_page | enter | engagement | typeahead"
    text account_id "v0.9.0 — Option B, hashed"
    smallint status
    timestamptz created_at
  }
  analytics_event {
    bigserial id PK
    bigint instance_id FK
    text event_type "click | conversion | cart_remove"
    text event_name
    text user_id "anon browser id"
    text account_id "v0.9.0 — Option B, hashed"
    text query_uid "soft FK -> query_log"
    text index_uid
    text object_id "WC product id"
    text object_name
    smallint position "GLOBAL 0-based rank (v0.9.0)"
    text cart_id "journey thread (reconciled)"
    text order_id "purchase grain (reconciled)"
    text placement "on-site surface: pdp/plp/search_results/related/heading (was source)"
    text origin
    timestamptz created_at
  }
```

## 4a. OPEN DECISION — event-store substrate (DEC-1)

> **Decision to be made, not yet made.** `analytics_event` is one row per event
> on a transactional Postgres (Supabase), but the workload is analytical
> (group-by, time-bucketing, funnels, per-`cart_id` folds) and high-volume
> (every click + typeahead probe + cart action). Whether the raw event store
> should stay OLTP Postgres or move to an analytics-optimised substrate
> (ClickHouse / Timescale columnar / warehouse / managed platform / hybrid) is
> **open** — it sets the dashboard data path, ingest-at-scale, and cost, so it is
> a precondition for further dashboard build-out. Recorded in
> [`../state/open-decisions.md`](../state/open-decisions.md) §B (DEC-1), with the
> related cart-state-model decision (DEC-2) and the PostHog mirror decision
> (DEC-5). Do not expand storage or rollups here until DEC-1 is decided.

## 5. Drift reconciliation (Constitution Art. 10)

The live `scout` DB carried `cart_id`, `order_id`, `source` on `analytics_event` with **no migration
file and no `scout_schema_version` row** — added out-of-band (likely the BYO/SDK work ~2026-06-05;
the SDK README's "journey keys" the event payload never actually sent). Migration
`20260627000002` formalizes them (`ADD COLUMN IF NOT EXISTS` — a no-op against the live DB) so the
repo is the source of truth again. `cart_id` and `order_id` are now **populated** (R-5); `source` is
left unpopulated until the work that introduced it is consulted.

## 6. Derivation layer — SHIPPED (2026-06-27)

The KPI rollups landed in the same push (decisions resolved: **daily tables, view-defined +
materialized** + **code-constant catalog**):

- **`metric_daily`** table (narrow: `instance_id, day, metric_key, grain, numerator, denominator,
  value, sample_size`) — GA4 `*_daily` shape (migration `20260627000003`).
- **View-defined logic** — `event_stream` → `session_assignment` (30-min/day) → `metric_daily_source`
  (every KPI as a daily row); single source of truth, cheap to change (migration `20260627000004`).
- **`refresh_metric_daily()`** materializer + **nightly pg_cron** `refresh-metric-daily` (05:20 UTC,
  yesterday — GA4 "through yesterday" convention) (migration `20260627000005`).
- **Metric catalog** as a typed code constant: `src/lib/analytics/metrics.ts` (`METRICS[]`), keys
  matching the view. **13 KPIs materialized**; the rest tagged `needs_instrumentation` / `later` with
  reasons.
- Backfilled from existing history + cross-checked (e.g. `no_result_rate` = 675/1795 = 0.376).

**`user_id` gap CLOSED (v0.10.0).** The browser id is now mirrored to a `grolabs_bid` cookie; PHP
reads it (`current_browser_id()`) and forwards it on the committed results-page search, so
`query_log.user_id` populates for committed searches → session/journey/intent stitching works on them.

**Still deferred** (tagged in `metrics.ts`): `journey_conversion` (identity-spanning, not a clean
daily grain); `click_to_pdp` / `pdp_to_cart` (need a **PDP-view event** — not emitted); `aov` /
`revenue_per_session` (need **order revenue** on the Completed-order event); `reformulation_*` (need
intent-grain rollup over `intent_group_id`). These are the next instrumentation items.

## 7. Related GroLabs modules / applications

- **Search Engine / proxy** (`/api/v1/search`, `src/lib/search/*`) — produces `query_log`; owns the
  committed flag + global position.
- **search-events.md** (locked) — the Meilisearch relevance-feedback subset; this doc's sibling. A
  dated pointer there references this doc for the un-gated own-store side.
- **Analytics — PostHog MVP** (`src/lib/analytics/*`) — `intent_group_id` + the query_log bridge this
  builds on; events also mirror to PostHog (`capturePostHog`).
- **GA4** ([`ga4-integration.md`](../policy/ga4-integration.md)) — the aggregate overlay sibling.
- **conversion-measurement-foundations.md** — the KPI grammar that reads this store.
- **unified-findings-and-monitoring.md** — turns measured leaks into findings.
- **search-proxy-event-pipeline.md** — the durable buffer that makes this store loss-free enough to
  feed revenue.
- **User & account management** ([`user-management.md`](../policy/user-management.md)) — the storefront
  WC login that produces the `account_id` Option B hashes (the merchant's WC customer, distinct from
  GroLabs staff auth).

## 8. External applications & required credentials

- **WordPress / WooCommerce** (merchant-owned) — runs the plugin; provides `is_user_logged_in()` /
  `get_current_user_id()` (hashed into `account_id`) and the WC session id (`cart_id`). No GroLabs
  credential beyond the per-instance API key the merchant pastes in (Constitution Art. 3).
- **Meilisearch Cloud** — relevance store; events authenticated with a per-instance **tenant token**
  minted by `/api/v1/events/token`. Holds the gated click/conversion subset only.
- **Supabase / Postgres** (`scout` project `ixbbhwtpnebrhquunege`) — stores `query_log` +
  `analytics_event`. Writes go through the **service-role** client from the receiver endpoints
  (storefront has no auth). RLS scopes reads to `instance_member`.
- **PostHog** — best-effort server-side mirror of search + events (`capturePostHog`). Key in
  `POSTHOG_*` env. (Terminology caution per `search-proxy-event-pipeline.md`: the SaaS vs our own
  post-hoc store.)
- **Anthropic API** — only for the future Demand-Interpretation agent (reformulation classification);
  not used by this tracking layer.

---

**End — directional. v0.9.0 instrumentation landed + verified; KPI derivation layer is the next pass.**
