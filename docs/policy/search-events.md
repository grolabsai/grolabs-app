GroLabs Search — Click & Conversion Event Tracking

Status: Active policy
Owner: Tuncho
Scope: Storefront-side relevance feedback events. Stage 4 of the search roadmap.
Audience: Claude Code (primary), future GroLabs contributors (secondary), anyone debugging "why don't I see events / why isn't relevance improving".

This document is the authoritative spec for how click and conversion events flow from a WooCommerce storefront into Meilisearch's analytics. **The single most-asked question this doc answers**: *"Where is the event data stored, and how do I see it?"* — Meilisearch Cloud's analytics dashboard, not Scout's database.

## 1. The flow at a glance

As of plugin v0.7.0 (Scout migration 20260520000002), events are **dual-written** — the plugin posts each event to both Meilisearch Cloud (for relevance training) and Scout (for the in-app analytics panel). The two writes are independent: a failure of one doesn't block the other.

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
Meilisearch's analytics      Scout's analytics_event table
        │                              │
        ▼                              ▼
Meilisearch dashboard        GroLabs admin → /configuration/search
(relevance feedback loop)    (Eventos recientes panel)
```

### Why both?

Meilisearch's `/events` is the **authoritative** store and the only one that feeds back into ranking relevance — Meilisearch consumes its own events to train. **We never give that up.**

Scout's `/api/v1/events` is a **local mirror** so the GroLabs admin can show event flow without leaving the app. Meilisearch Cloud's Build tier ($30/mo) exposes events **only via the web dashboard** — there's no programmatic read API outside Enterprise. Without the mirror, the only path to "show me what's happening with my search" is "log into Meilisearch Cloud as a developer", which we don't want to ask merchants to do.

### Roles

- **Plugin** ([assets/js/grolabs-wordpress-search-events.js](../../grolabs-wordpress-search/assets/js/grolabs-wordpress-search-events.js)) — dual-writes per event. Both POSTs use `keepalive: true` so they complete even if the user navigates away.
- **Scout `/api/v1/events/token`** ([src/app/api/v1/events/token/route.ts](../../src/app/api/v1/events/token/route.ts)) — mints the Meilisearch tenant token. Token is scoped to the caller's instance, lives 15 min, refreshed on demand.
- **Scout `/api/v1/events`** ([src/app/api/v1/events/route.ts](../../src/app/api/v1/events/route.ts)) — receives the mirror POST. Validates origin against `instance.storefront_domains` (same trust model as `/api/v1/search`), inserts into `analytics_event`.
- **Scout `analytics_event` table** ([migration 20260520000002](../../supabase/migrations/20260520000002_analytics_event.sql)) — local store. RLS scopes SELECT to `instance_member`; writes only via service-role from the receiver endpoint.

### Backwards compatibility

Plugin versions **before v0.7.0** post only to Meilisearch — they don't know the Scout endpoint exists. On a merchant running an older plugin, the Scout `/configuration/search` events panel will show empty (with a clear "no events recorded yet" message). Upgrade the plugin to start mirror-writing.

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

1. **GroLabs admin → `/configuration/search` → "Eventos recientes" card** (Scout's local mirror, v0.7.0+ plugin required). 24h counts per event name plus the last 50 individual events with product names, position, and `queryUid`. Polled every 5 s.
2. **Meilisearch Cloud → project → Analytics → Events** — the authoritative store. Filter by event name or `queryUid`. Events appear within seconds of the storefront emitting them.
3. **Browser DevTools → Network tab** on the storefront. Filter to `events`. You should see **two** parallel POSTs per event in v0.7.0+: one to `{meili_host}/events` (Bearer-tokened) and one to `{GROLABS_API_HOST}/api/v1/events` (no auth header — origin-validated). Either failing independently is fine.

`console.warn` lines starting with `Grolabs:` in the DevTools Console call out specific failures (`Grolabs: token endpoint status …`, `Grolabs: <EventName> not recorded …`).

The "we don't see events" failure modes, in order of frequency:

1. **Instance ID not configured** in the plugin settings → events.js bails out at module-load time. Check plugin settings page.
2. **Token endpoint returning non-200** → check Scout's `/api/v1/events/token` route response. Most often a `storefront_domains` mismatch (origin not whitelisted).
3. **No `queryUid` in the attribution store** → user never clicked a search result first. Test by searching, clicking a result, THEN adding to cart.
4. **Looking at the wrong place** — if you're looking at Scout's Supabase tables expecting to find events, this doc is the answer: they're not there. Open Meilisearch Cloud.

## 6. Non-goals

- **No cross-device user attribution.** `userId` is a random UUID stored in `localStorage`; clearing the browser starts a new identity.
- **No aggregation API on Scout.** If a future feature needs to surface event counts in the Scout admin UI, that's net-new work — likely a webhook from Meilisearch into Scout, or a Scout-side proxy that queries Meilisearch's analytics API on demand.
- **No retries on event POST failures.** Best-effort, async, page-paint-blocking would be worse than the occasional lost signal.
- **No PII in events.** `userId` is anonymous; `objectId`/`objectName` come from the product catalog.

## 7. Versions

| Plugin version | Change |
|---|---|
| v0.3.0 | Click events shipped — `Search Result Clicked` from results-page cards. |
| v0.4.1 | Click events extended to typeahead dropdown items. |
| v0.5.0 | All four conversion event types shipped. Attribution store added. |
| v0.7.0 | Dual-write to Scout's `/api/v1/events` for the in-app analytics panel. Meilisearch path unchanged. |

The flow described in this doc reflects v0.7.0+ behavior.
