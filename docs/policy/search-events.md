---
application: core-app
module: Policy
title: "GroLabs Search — Click & Conversion Event Tracking"
status: Active
owner: "Tuncho"
scope: "Storefront-side relevance feedback events. Stage 4 of the search roadmap."
audience: "Claude Code (primary), future GroLabs contributors (secondary), anyone debugging \"why don't I see events / why isn't relevance improving\"."

actors:
  - name: Customer
    type: human
    definition: A storefront shopper who clicks search results and converts (add-to-cart, checkout, order) on the WooCommerce site.
  - name: WP plugin
    type: plugin
    definition: grolabs-wordpress-search; its events.js dual-writes each event to Meilisearch and RRE using keepalive POSTs.
  - name: Meilisearch
    type: integration
    definition: The authoritative event store; consumes its own events to train ranking relevance.
  - name: RRE
    type: system
    definition: Receives the mirror POST, validates origin, and stores events in analytics_event for the in-app panel.
  - name: Merchant
    type: human
    definition: Views recent events in GroLabs admin → /configuration/search.

users:
  - name: Merchant
    description: Watches the "Eventos recientes" panel without leaving the app or logging into Meilisearch Cloud.

integrations:
  - name: Meilisearch /events
    kind: external-service
    target: meilisearch
    direction: out
    purpose: Authoritative event store and the only path that feeds back into ranking relevance.
  - name: RRE /api/v1/events
    kind: internal-module
    target: rre
    direction: in
    purpose: Local mirror receiver; origin-validated, inserts into analytics_event.
  - name: RRE /api/v1/events/token
    kind: internal-module
    target: meilisearch
    direction: out
    purpose: Mints the Meilisearch tenant token scoped to the caller's instance, 15-minute lifetime.

permissions:
  - actorId: Merchant
    capability: select-analytics-event
    effect: conditional
    note: RLS scopes analytics_event SELECT to instance_member.
  - actorId: RRE
    capability: write-analytics-event
    effect: allow
    note: Writes happen only via the service-role client from the receiver endpoint.

credentials:
  - name: Meilisearch tenant token
    location: Minted by /api/v1/events/token; cached in-memory for the page lifetime
    scope: searchRules pinned to the caller's instance index
    rotation: 15-minute lifetime; cache invalidated 60s before expiry

rules:
  - id: R-1
    statement: As of plugin v0.7.0 each event is dual-written to both Meilisearch Cloud and RRE; the two writes are independent and a failure of one does not block the other.
    truth: true
  - id: R-2
    statement: Meilisearch's /events is the authoritative store and the only one that feeds ranking relevance; RRE's analytics_event is a local mirror.
    truth: true
    rationale: Meilisearch Build tier exposes events only via the web dashboard, so the mirror is the only programmatic read path for the admin UI.
  - id: R-3
    statement: Both POSTs use keepalive:true so they complete even if the user navigates away.
    truth: true
  - id: R-4
    statement: Event-type names are stable strings; renaming one splits historical data across two labels in Meilisearch's dashboard.
    truth: true
  - id: R-5
    statement: A conversion without a queryUid is rejected; attribution comes from a per-product localStorage store (7-day TTL, 100-entry LRU), and no attribution means no event.
    truth: true
  - id: R-6
    statement: Variable products are attributed to the parent product_id because that is what the search index keys on.
    truth: true
  - id: R-7
    statement: Event delivery is best-effort — no retries, no queue; occasional event loss is acceptable for this signal.
    truth: true
    rationale: A pending 2026-05-29 amendment would move to a durable buffer once events feed revenue findings; not yet applied.
  - id: R-8
    statement: The tenant token's searchRules pin it to the caller's instance, so even if a merchant exposes it via DevTools the worst they can do is write events for their own instance.
    truth: true
  - id: R-9
    statement: The RRE receiver validates origin against instance.storefront_domains, mirroring the /api/v1/search trust model.
    truth: true
  - id: R-10
    statement: Events carry no PII — userId is an anonymous localStorage UUID and there is no cross-device user attribution.
    truth: true
  - id: R-11
    statement: A pending amendment (2026-05-29) will add Remove-from-cart and an un-gated Completed-order write to analytics_event, a userId column on query_log, and RRE-side aggregation; this doc remains authoritative until that amendment merges.
    truth: unverified
  - id: R-12
    statement: RRE forwards events server-side to PostHog (the external product) — "Search Performed" from /api/v1/search and click/conversion from /api/v1/events — via posthog-node inside Next after(), best-effort and a no-op when POSTHOG_API_KEY is unset. This is a third destination alongside Meilisearch (authoritative/relevance) and analytics_event (local mirror); posthog-js is never loaded on the storefront.
    truth: true
    rationale: Cross-event analytics and funnels (keyword↔conversion, journeys, intent) need a query engine Meilisearch's events dashboard and the flat analytics_event table don't provide. Forwarding is additive — neither existing write path changed. See docs/design/posthog-analytics-mvp.md.

useCases:
  - id: T-1
    title: Click-then-convert fires an attributed conversion
    given: A customer clicked a search result, storing its queryUid
    when: They add that product to cart
    then: A conversion event fires carrying the stored queryUid
    verifies: [R-5]
  - id: T-2
    title: Direct navigation produces no conversion event
    given: A customer who reached a product without searching
    when: They add to cart and complete the order
    then: Zero conversion events are generated because there is no search to credit
    verifies: [R-5]
  - id: T-3
    title: One failed write does not block the other
    given: An event being dual-written
    when: The Meilisearch POST or the RRE POST fails independently
    then: The other write still records the event
    verifies: [R-1]
  - id: T-4
    title: Older plugin shows an empty mirror panel
    given: A merchant running a plugin older than v0.7.0
    when: They open the "Eventos recientes" panel
    then: It shows a clear "no events recorded yet" message
  - id: T-5
    title: Completed order fires exactly once
    given: An order-received page load
    when: The Completed-order handler runs, deduped via localStorage keyed on orderId
    then: The event fires exactly once per order, ever
    verifies: [R-4]
---

GroLabs Search — Click & Conversion Event Tracking

Status: Active policy
Owner: Tuncho
Scope: Storefront-side relevance feedback events. Stage 4 of the search roadmap.
Audience: Claude Code (primary), future GroLabs contributors (secondary), anyone debugging "why don't I see events / why isn't relevance improving".

This document is the authoritative spec for how click and conversion events flow from a WooCommerce storefront into Meilisearch's analytics. **The single most-asked question this doc answers**: *"Where is the event data stored, and how do I see it?"* — Meilisearch Cloud's analytics dashboard, not RRE's database.

## 1. The flow at a glance

As of plugin v0.7.0 (RRE migration 20260520000002), events are **dual-written** — the plugin posts each event to both Meilisearch Cloud (for relevance training) and RRE (for the in-app analytics panel). The two writes are independent: a failure of one doesn't block the other.

```
Customer clicks a search result on the WP storefront
        │
        ├──────────────────────────────┐
        ▼                              ▼
WP plugin's events.js fires TWO parallel POSTs
        │                              │
        ▼                              ▼
POST {meili_host}/events    POST {GROLABS_API_HOST}/api/v1/events
(with tenant token)          (with instance_id + origin)
        │                              │
        ▼                              ▼
Meilisearch's analytics      RRE's analytics_event table
        │                              │
        ▼                              ▼
Meilisearch dashboard        GroLabs admin → /configuration/search
(relevance feedback loop)    (Eventos recientes panel)
```

### Why both?

Meilisearch's `/events` is the **authoritative** store and the only one that feeds back into ranking relevance — Meilisearch consumes its own events to train. **We never give that up.**

RRE's `/api/v1/events` is a **local mirror** so the GroLabs admin can show event flow without leaving the app. Meilisearch Cloud's Build tier ($30/mo) exposes events **only via the web dashboard** — there's no programmatic read API outside Enterprise. Without the mirror, the only path to "show me what's happening with my search" is "log into Meilisearch Cloud as a developer", which we don't want to ask merchants to do.

### Roles

- **Plugin** ([assets/js/grolabs-wordpress-search-events.js](../../grolabs-wordpress-search/assets/js/grolabs-wordpress-search-events.js)) — dual-writes per event. Both POSTs use `keepalive: true` so they complete even if the user navigates away.
- **RRE `/api/v1/events/token`** ([src/app/api/v1/events/token/route.ts](../../src/app/api/v1/events/token/route.ts)) — mints the Meilisearch tenant token. Token is scoped to the caller's instance, lives 15 min, refreshed on demand.
- **RRE `/api/v1/events`** ([src/app/api/v1/events/route.ts](../../src/app/api/v1/events/route.ts)) — receives the mirror POST. Validates origin against `instance.storefront_domains` (same trust model as `/api/v1/search`), inserts into `analytics_event`.
- **RRE `analytics_event` table** ([migration 20260520000002](../../supabase/migrations/20260520000002_analytics_event.sql)) — local store. RLS scopes SELECT to `instance_member`; writes only via service-role from the receiver endpoint.

### Backwards compatibility

Plugin versions **before v0.7.0** post only to Meilisearch — they don't know the RRE endpoint exists. On a merchant running an older plugin, the RRE `/configuration/search` events panel will show empty (with a clear "no events recorded yet" message). Upgrade the plugin to start mirror-writing.

## 2. The five event types

All five live on the WP plugin. Names are stable strings — changing one splits historical data in Meilisearch's dashboard across two labels.

| Name | `eventType` | Fires from |
|---|---|---|
| `Search Result Clicked` | `click` | Delegated handler on `.grolabs-wordpress-search-product-card`. Both results-page cards and typeahead dropdown items emit this (typeahead path wired in plugin v0.4.1). |
| `Added to cart from PLP` | `conversion` | Click on `.add_to_cart_button` (etc.) when the page context is NOT a single-product page. |
| `Added to cart from PDP` | `conversion` | Same handler, single-product context. Discrimination is by `is_product()` flag PHP localizes — not by button class, which themes reuse. |
| `Proceeded to check out` | `conversion` | DOMContentLoaded on `/checkout/`. Reads `window.GrolabsWordPressSearchCheckout = {items: [{id, name}, …]}` injected by the plugin's PHP. One event per attributed cart item. Deduped via `sessionStorage` keyed on the sorted cart-id hash. |
| `Completed order` | `conversion` | DOMContentLoaded on `/checkout/order-received/<id>/`. Reads `window.GrolabsWordPressSearchOrder = {items, orderId}` injected by PHP. One event per attributed order item. Deduped via `localStorage` keyed on `orderId` — fires exactly once per order, ever. |

## 3. Attribution

Conversion events without a `queryUid` are useless to Meilisearch (and the SDK rejects them). The plugin solves this with a per-product attribution store in `localStorage`:

- **On every click on a search result** (results-page card OR typeahead item), the plugin writes `{queryUid, indexUid, position, name, ts}` keyed by `product_id` to `localStorage["grolabs_wordpress_search_attribution"]`.
- **TTL** — 7 days. Older entries get pruned on next write.
- **Cap** — 100 entries, LRU. Pruned on next write.
- **On every conversion**, the plugin looks up the productId, finds the attribution, fires the conversion event with that `queryUid`.
- **No attribution → no event.** A customer who navigates to a product directly (no search), adds it to cart, completes the order generates zero conversion events. Correct: there's no search to credit.

Variable products are attributed to **parent** product_id since that's what the search index keys on.

## 4. Token lifecycle

The Meilisearch tenant token is fetched by the plugin's events.js on first use and cached in memory for the page lifetime. Refresh logic:

- Token includes `expires_at` (unix seconds). The cache invalidates 60 s before that to avoid using a token that expires mid-request.
- A single in-flight token request is reused across concurrent event submissions (no thundering herd).
- Failures are non-fatal — events are best-effort. A logged warning to `console.warn` is the entire error path; no retries, no queue. Event loss is acceptable for this signal.

The token's `searchRules` include the index uid filter pinning to the caller's instance, so even though the token CAN be exposed via DevTools by a determined merchant, the worst they can do is write events for their own instance — which they're already authorized to do.

## 5. Where to verify events

Three places, each showing the same events from a different angle:

1. **GroLabs admin → `/configuration/search` → "Eventos recientes" card** (RRE's local mirror, v0.7.0+ plugin required). 24h counts per event name plus the last 50 individual events with product names, position, and `queryUid`. Polled every 5 s.
2. **Meilisearch Cloud → project → Analytics → Events** — the authoritative store. Filter by event name or `queryUid`. Events appear within seconds of the storefront emitting them.
3. **Browser DevTools → Network tab** on the storefront. Filter to `events`. You should see **two** parallel POSTs per event in v0.7.0+: one to `{meili_host}/events` (Bearer-tokened) and one to `{GROLABS_API_HOST}/api/v1/events` (no auth header — origin-validated). Either failing independently is fine.

`console.warn` lines starting with `Grolabs:` in the DevTools Console call out specific failures (`Grolabs: token endpoint status …`, `Grolabs: <EventName> not recorded …`).

The "we don't see events" failure modes, in order of frequency:

1. **Instance ID not configured** in the plugin settings → events.js bails out at module-load time. Check plugin settings page.
2. **Token endpoint returning non-200** → check RRE's `/api/v1/events/token` route response. Most often a `storefront_domains` mismatch (origin not whitelisted).
3. **No `queryUid` in the attribution store** → user never clicked a search result first. Test by searching, clicking a result, THEN adding to cart.
4. **Looking at the wrong place** — if you're looking at RRE's Supabase tables expecting to find events, this doc is the answer: they're not there. Open Meilisearch Cloud.

## 6. Non-goals

> **⚠️ Pending amendment (2026-05-29) — do not treat the non-goals below as final.**
> The unified-findings / event-pipeline work will change several of these once approved. See
> [`docs/design/unified-findings-and-monitoring.md`](../design/unified-findings-and-monitoring.md)
> and [`docs/design/search-proxy-event-pipeline.md`](../design/search-proxy-event-pipeline.md).
> Specifically: best-effort/loss-acceptable (below + §4) no longer holds once events feed revenue
> findings (→ durable buffer); "no aggregation API on RRE" (below) is reversed (→ we roll up our
> side); and the event list (§2) gains **Remove-from-cart** + an **un-gated Completed-order** write
> to `analytics_event`, plus a `userId` column on `query_log`. **Not yet applied — this doc remains
> authoritative until the amendment is approved and merged.**
>
> **✅ Partially landed (2026-06-03, PostHog Analytics MVP).** The `query_log` bridge columns are now
> applied — `user_id` (the `userId` the banner foreshadowed), `query_uid`, and `intent_group_id`
> (migrations `20260603000001`, `20260603000002`). The aggregation reversal is realized via **PostHog**
> rather than a Meilisearch webhook (see the amended "No aggregation API on RRE" bullet + R-12). The
> durable buffer, Remove-from-cart, and the un-gated Completed-order write remain unapplied.
>
> **✅ Own-store side landed (2026-06-27, plugin v0.9.0). New home:**
> [`docs/design/event-tracking.md`](../design/event-tracking.md). The un-gated firing,
> **Remove-from-cart** (eventType `cart_remove`, own-store only), the un-gated **Completed-order**
> write, plus `account_id` (Option B identity), `cart_id`/`order_id` journey keys, committed-search
> marking, and global click position **now live on the OWN STORE** (`analytics_event` / `query_log`).
> **The Meilisearch path in this doc is unchanged and still authoritative** — it stays
> `queryUid`-gated (the fence). The best-effort-loss (§4) and no-aggregation (§6) non-goals are
> superseded **for the own store only**; they still describe the Meilisearch relevance loop. See
> `event-tracking.md` for the consolidated tracking model.

- **No cross-device user attribution.** `userId` is a random UUID stored in `localStorage`; clearing the browser starts a new identity.
- **~~No aggregation API on RRE.~~ Cross-event analytics live in PostHog (2026-06-03).** RRE forwards events server-side to the external PostHog product (R-12), where keyword↔conversion, journeys, and intent funnels are queried. The local `analytics_event` / `query_log` store still powers the in-app admin panels (`/configuration/search`), and Meilisearch remains the only relevance-training path. A Meilisearch→RRE webhook is no longer needed for aggregation.
- **No retries on event POST failures.** Best-effort, async, page-paint-blocking would be worse than the occasional lost signal.
- **No PII in events.** `userId` is anonymous; `objectId`/`objectName` come from the product catalog.

## 7. Versions

| Plugin version | Change |
|---|---|
| v0.3.0 | Click events shipped — `Search Result Clicked` from results-page cards. |
| v0.4.1 | Click events extended to typeahead dropdown items. |
| v0.5.0 | All four conversion event types shipped. Attribution store added. |
| v0.7.0 | Dual-write to RRE's `/api/v1/events` for the in-app analytics panel. Meilisearch path unchanged. |
| v0.8.0 | Search POST to `/api/v1/search` now sends the anonymous `userId` (same localStorage session id the events use), so `query_log.user_id` populates for journey + intent stitching. Cache-buster bump required for the new `typeahead.js` to load. |
| v0.9.0 | **Event-tracking foundations** ([`event-tracking.md`](../design/event-tracking.md)): un-gated own-store firing for all conversions + new `Removed from cart` (`cart_remove`); `account_id` (Option B identity), `cart_id`, `order_id` on `analytics_event`; committed-search marking + global click position on `query_log`. Meilisearch path unchanged (still `queryUid`-gated). |

The flow described in this doc reflects v0.7.0+ behavior.
