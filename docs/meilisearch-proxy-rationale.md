---
application: core-app
module: Foundation
title: "Why the GroLabs proxy sits between the WordPress plugin and Meilisearch"
status: Draft
owner: "Tuncho (GroLabs)"
audience: "Meilisearch engineering / product"
scope: "A focused justification of every responsibility the thin GroLabs proxy provides between the WordPress plugin and Meilisearch Cloud, what Meilisearch would need to absorb each one, and a set of asks/questions about collapsing the hop and Cloud analytics drilldowns."

actors:
  - name: Shopper
    type: human
    definition: Searches from the storefront box. In Stage 2 the in-browser widget calls search directly; today the WP plugin makes the call.
  - name: WordPress plugin
    type: plugin
    definition: PHP running inside the merchant's WP install. Knows only its instance_id (public, like a Stripe publishable key) and the GroLabs API base URL — never the Meilisearch host, master key, or even a tenant token. POSTs to the proxy with its browser Origin header.
  - name: GroLabs proxy
    type: system
    definition: ~330-line Next.js route on Vercel, single multi-tenant deployment. Origin-bound trust, token minting, rate limiting, filter pinning, variant resolution, query logging. Intentionally thin — no business logic beyond matched_variation.
  - name: Meilisearch Cloud
    type: integration
    definition: One project, one index per instance (inst_<id>). Performs the actual search, stemming, synonym expansion, typo tolerance, ranking, and returns _matchesPosition. Holds the analytics the proxy cannot see (queries that reached the index, processing times).
  - name: Operator
    type: human
    definition: Authenticated instance_member using /configuration/search — the live query-log tail, the operator-only search preview (Supabase-session auth, bypassing rate limit and query_log), and per-token match pills.

integrations:
  - name: Meilisearch Cloud search
    kind: external-service
    target: meilisearch.index('inst_<id>').search(...)
    direction: both
    purpose: The downstream search call. Proxy passes the query unchanged (no rewriting), preserves result order (no reranking), no caching, no fan-out.
  - name: Meilisearch Cloud /events
    kind: external-service
    target: Meilisearch analytics API
    direction: out
    purpose: The storefront posts click events directly to /events (authenticated via a short-lived events token) so each click is attributed to the query via metadata.queryUid.
  - name: Postgres query_log
    kind: internal-module
    target: query_log table
    direction: out
    purpose: Per-request log (success and every denial) with query text, status + denial reason, hits, Meilisearch processing time, total handler time, origin host, returned product IDs/names, and variant selection — the single most important cross-system debugging surface.
  - name: WooCommerce catalog
    kind: external-service
    target: GroLabs Postgres (product, product_variant, product_pricing, ...)
    direction: in
    purpose: Pulled, enriched (HTML strip, variation_summary, taxonomy-slug normalization, canonical URL), then pushed to Meilisearch. The plugin and merchant never write to Meilisearch.

credentials:
  - name: Meilisearch master key
    location: GroLabs server-side (src/lib/search/meilisearch-client.ts)
    scope: Full admin — minting tenant tokens, index settings writes, indexing pipeline. Never shipped to the plugin or browser.
    rotation: Not specified here
  - name: Meilisearch tenant token
    location: Minted on demand by POST /api/v1/search/token
    scope: Scoped to inst_<id> with a defense-in-depth filter instance_id = <id>; 15-minute TTL. Used by the Stage 2 in-browser widget.
    rotation: 15-minute TTL (re-minted per use)
  - name: Meilisearch events token
    location: Minted by /api/v1/events/token
    scope: Short-lived, lets the storefront post click/conversion events directly to Meilisearch /events.
    rotation: Short-lived
  - name: instance_id
    location: Public identifier held by the WP plugin / browser bundle
    scope: Public, like a Stripe publishable key — names the tenant; the Origin allowlist (not this id) is the security boundary.
    rotation: Stable per instance

rules:
  - id: R-1
    statement: The WP plugin never calls Meilisearch directly — it calls a thin GroLabs proxy that holds the master key end-to-end; the plugin knows only its public instance_id and the GroLabs API base URL.
    truth: true
    rationale: §"full request path". The hop is real latency the team would rather not pay, but it carries the responsibilities below.
  - id: R-2
    statement: Origin-bound trust without a server-side secret — the proxy reads instance.storefront_domains and rejects any request whose Origin host is not allowlisted, returning a generic 403 for bad ID, inactive instance, and wrong origin alike (no enumeration leak). The Origin allowlist is the security boundary; instance_id is public.
    truth: true
    rationale: §1. Avoids shipping a long-lived secret to PHP or the browser; merchants control the allowlist in /configuration/search.
  - id: R-3
    statement: Short-lived tenant tokens are minted on demand — POST /api/v1/search/token exchanges instance_id + valid Origin for a token scoped to inst_<id> with filter instance_id=<id>, 15-min TTL, used by the in-browser widget. Minting requires the master key, so it happens server-side.
    truth: true
    rationale: §2. The master key stays server-side; the merchant only holds the public instance_id.
  - id: R-4
    statement: Two rate-limit buckets per endpoint — per-IP (600/min, applied before any DB lookup) and per-(instance_id, origin) (60/min for the token endpoint, higher for search); 429 on either. Per-IP runs first (cheapest); the per-pair check runs after instance validation so throttled calls are still attributable.
    truth: true
    rationale: §3. Protects shared infra and Meilisearch query budget from bot/scraper/misconfigured-plugin loops; 429 before paying for the search.
  - id: R-5
    statement: Filter pinning (defense in depth) — whatever filter the caller supplies is wrapped as (<caller filter>) AND instance_id = <id>, belt-and-suspenders on top of the per-instance index name, so a bug elsewhere can never serve cross-instance results.
    truth: true
    rationale: §4. Cheap insurance; one extra clause. Moves with tenant tokens automatically if direct-from-plugin tokens land.
  - id: R-6
    statement: Variant resolution — for each hit the proxy computes a full matched_variation (id, sku, attributes, price, image, stock) from the parent's variants[] using _matchesPosition (simple→null, variable_single→that variation, variable_multi→highest-match in-stock variant with fallbacks). This is genuine application logic about what to render and is kept server-side for reuse across the future browser widget and React Native client.
    truth: true
    rationale: §5. Powers the two-button storefront card ("Agregar 4kg al carrito"); chosen over one-document-per-variation to avoid index bloat and near-duplicate hits.
  - id: R-7
    statement: Every request (success and every denial) appends a query_log row with query text, status + denial reason, hits, Meilisearch processing time, total handler time, origin host, returned product IDs/names, and variant selection. /configuration/search shows a live tail polling every 2s — the primary cross-system debugging surface.
    truth: true
    rationale: §6. Meilisearch analytics show only Meilisearch's view; they miss pre-Meilisearch rejections, the IDs handed back, total handler time, and per-tenant breakdown.
  - id: R-8
    statement: The proxy is boringly thin — no query rewriting, no result reranking, no result caching, no request fan-out, and no business logic beyond matched_variation. One inbound request maps to one outbound Meilisearch call.
    truth: true
    rationale: §"what the proxy does not do". The round-trip cost is dominated by network, not code (Meilisearch 5–40ms; total handler 60–180ms; implied overhead + WP→GroLabs network 50–150ms).
  - id: R-9
    statement: GroLabs is the canonical product database, not WooCommerce — WC's catalog is pulled into Postgres, enriched (HTML strip, variation_summary, taxonomy-slug normalization, canonical URL), then pushed to Meilisearch. The plugin and merchant never write to Meilisearch.
    truth: true
    rationale: §8. Enrichment is the product moat (future agent-driven attribute extraction) and is reused beyond search (pricing, dashboards, sync); it runs on writes, off the hot path.
  - id: R-10
    statement: The minimum Meilisearch primitive needed to collapse the read-path proxy is a public per-index key with an origin allowlist, per-(key, origin) rate limiting, and account-visible request events including rejections; tenant tokens already cover scoping. matched_variation would at most shrink to ~25 lines on a Worker.
    truth: unverified
    rationale: §"what we'd give up" + asks 1–5. This is a proposal/ask to Meilisearch, not an existing capability — hence unverified.
  - id: R-11
    statement: Open Cloud-analytics questions — enumerate no-result queries, per-keyword CTR and conversion, per-product CTR/avg-position/conversion, drilling generic metrics down to keyword/product/category/time cohorts, query-time tagging for A/B cohorting, and event retention (need 90–120 days). If unavailable, GroLabs keeps accumulating analytics in query_log, keeping the proxy on the hot path longer.
    truth: unverified
    rationale: §"open questions about Cloud analytics" Q1–Q7. Open questions to Meilisearch; answers determine how thin the proxy can become.

useCases:
  - id: T-1
    title: Wrong-origin request is rejected indistinguishably
    given: A request carrying an Origin host not in instance.storefront_domains
    when: The proxy validates the request
    then: It returns a generic 403 identical to bad-ID and inactive-instance responses, so the endpoint cannot be enumerated; a denial row is still written to query_log
    verifies: [R-2, R-7]
  - id: T-2
    title: Multi-variant card shows the matched size
    given: A shopper searches "4kg Royal Canin Puppy" for a product with 1kg/4kg/12kg variants
    when: The proxy reads _matchesPosition and counts matches per variant index
    then: It returns matched_variation for the in-stock 4kg variant, powering "Agregar 4kg al carrito" as the primary card action
    verifies: [R-6]
  - id: T-3
    title: Debugging "search says no results"
    given: A merchant reports their storefront search shows no results
    when: An operator checks /configuration/search live tail
    then: The query_log row shows the proxy returned N hits with their product IDs, proving the plugin is filtering them rather than the search failing
    verifies: [R-7]
  - id: T-4
    title: Operator preview bypasses the public path
    given: An authenticated instance_member on /configuration/search
    when: They run the operator-only search preview against the instance index
    then: The query runs via Supabase session auth (not instance_id/origin), bypasses rate limiting and query_log, and renders per-token green/red match pills with attribute-path tooltips
    verifies: [R-8]
---

# Why the GroLabs proxy sits between the WordPress plugin and Meilisearch

Status: Discussion brief for the Meilisearch team
Owner: Tuncho (GroLabs)
Date: 2026-05-20
Audience: Meilisearch engineering / product

---

## Purpose of this document

The WordPress plugin we ship to merchants does **not** call Meilisearch directly. It calls a thin proxy hosted by GroLabs (Next.js on Vercel), and the proxy calls Meilisearch Cloud. The hop is real latency we'd rather not pay.

We wrote this to be precise about *why* the proxy exists today, so we can have an informed conversation about which of these responsibilities Meilisearch could absorb. If most of them can move into Meilisearch (or be made unnecessary), we'll happily collapse the hop. If a few must stay in GroLabs, we want to know which ones so we can engineer the proxy down to just those.

Each section names a concrete capability the proxy provides, the *reason* we put it there, and — where applicable — what would need to exist in Meilisearch (or its tenant tokens / Cloud control plane) for the responsibility to move.

The full spec for the system this proxy serves is in `docs/policy/search-foundations.md`. This document is a focused subset aimed at the proxy itself.

---

## The full request path today

```
shopper search box
        │
        ▼
WordPress plugin   (PHP, runs inside merchant's WP install)
        │   POST /api/v1/search   { instance_id, query, limit, offset, filters, sort }
        ▼
GroLabs proxy      (Next.js on Vercel, single deployment, multi-tenant)
        │   meilisearch.index('inst_<id>').search(..., { showMatchesPosition: true })
        ▼
Meilisearch Cloud  (one project, one index per instance)
```

The WordPress plugin never sees the Meilisearch host, the master key, or even a tenant token. It only knows two things: its merchant's GroLabs `instance_id` (a public identifier, like a Stripe publishable key) and the GroLabs API base URL.

The proxy's full implementation is ~330 lines in `src/app/api/v1/search/route.ts`. It is intentionally thin — it does no business logic of its own beyond what's listed below.

---

## What the proxy does that Meilisearch does not (today)

### 1. Origin-bound trust without a server-side secret

**What it does.** The plugin POSTs `{ instance_id }` along with its browser `Origin` header. The proxy looks up the instance in our Postgres, reads `instance.storefront_domains text[]` (a per-instance allowlist of hostnames the merchant configured in their GroLabs admin), and **rejects any request whose Origin host is not in that list**. Errors are deliberately generic — bad ID, inactive instance, and wrong origin all return the same 403 body so the endpoint can't be enumerated.

**Why we did it this way.** The WordPress plugin runs in PHP on a merchant's own server, but the actual search calls in our Stage 2 instant-results widget will run in the shopper's browser. We didn't want to ship a long-lived secret to either place. `instance_id` is public; the Origin allowlist *is* the security boundary. Merchants control the allowlist themselves through their GroLabs settings page (`/configuration/search`).

**What would replace this in Meilisearch.** Tenant tokens give us per-instance scoping, but the merchant still has to obtain one, which means somewhere there's a key exchange. If Meilisearch Cloud offered:

- A "publishable instance key" concept (long-lived, public, scoped to one index, no admin rights, no search rate)
- Origin allowlisting on that key, enforced by Cloud's edge, configurable through the Cloud control plane or API
- Generic 403s on origin mismatch (no enumeration leak)

...then the WordPress plugin could call Meilisearch directly with that key. We'd still need our admin UI to *configure* the allowlist, but the request path could skip us.

---

### 2. Short-lived tenant tokens, minted on demand

**What it does.** A separate endpoint, `POST /api/v1/search/token`, exchanges `{ instance_id }` + valid Origin for a tenant token scoped to `inst_<instance_id>` with a defense-in-depth filter `instance_id = <id>`, 15-minute TTL. Used by the in-browser widget (Stage 2) so we don't expose the master key.

**Why.** Same reason any SaaS does this — we own the master key end-to-end and the merchant only holds the public `instance_id`. Tenant token minting requires the master key, so it has to happen server-side.

**What would replace this in Meilisearch.** Meilisearch already supports tenant tokens; the missing piece is a way to mint them *from a public identity + origin proof* instead of from the master key. If Cloud could mint a tenant token for an "instance key" plus the verified Origin (server-validated against the allowlist from §1), our token endpoint disappears.

---

### 3. Per-IP and per-(instance, origin) rate limiting

**What it does.** Two buckets per endpoint:
- Per-IP: 600/min (shared-infra protection, applied before any DB lookup)
- Per-(instance_id, origin): 60/min for the token endpoint, higher for search

429s on either bucket. The per-IP check runs first because it's the cheapest. The per-pair check runs after we've validated the instance exists, so a throttled call can still be attributed to the right tenant in our logs.

**Why.** WordPress storefronts get hit by bots, scrapers, and the occasional misconfigured plugin. We didn't want a runaway loop on one merchant's site to spend our Meilisearch query budget or to drown out other merchants. Putting the limiter in front of Meilisearch also means we can return 429 without paying for the search.

**What would replace this in Meilisearch.** Per-key rate limits at the Cloud edge, configurable through the control plane, ideally with both per-IP and per-(key, origin) dimensions. Today our impression is that Cloud has account-level limits but not the granular per-key throttling we need to safely hand keys to merchants.

---

### 4. Filter pinning (defense in depth)

**What it does.** Whatever filter string the caller supplies, the proxy wraps it: `(<caller filter>) AND instance_id = <id>`. The index name `inst_<id>` already enforces isolation, but we belt-and-suspenders by also requiring the document's `instance_id` field to match. If we ever switched to a shared-index model, the same code keeps working.

**Why.** Cheap insurance. The cost is one extra clause; the value is that we can never accidentally serve cross-instance results because of a bug elsewhere.

**What would replace this in Meilisearch.** Tenant tokens with a baked-in filter already do exactly this — if we move to direct-from-plugin tenant tokens (§2), this responsibility moves with them automatically.

---

### 5. Variant resolution (`matched_variation`)

**What it does.** For each Meilisearch hit, the proxy computes a `matched_variation`: a *full* variant object (id, sku, attributes, price, image, stock) lifted out of the parent product's `variants[]` array. The rules:

- `simple` product → `matched_variation = null`
- `variable_single` (one purchasable variation) → that variation
- `variable_multi` → read Meilisearch's `_matchesPosition`, count matches per variant index (e.g. `variants.0.attributes.pa_size`), pick the in-stock variant with the highest count. Fall back to the parent's default variation, then first-in-stock, then null.

This is what powers the storefront's two-button card UX: when a shopper searches "4kg Royal Canin Puppy" and the product has variants for 1kg / 4kg / 12kg, the card shows **"Agregar 4kg al carrito"** as the primary action and "Ver otros tamaños" as the secondary. Without variant resolution we'd have to send the shopper to the product page to pick a size — which is exactly the search UX we're trying to beat.

We chose this over the "one document per variation" model deliberately. Indexing 50,000 simple products plus 200,000 variations as separate documents bloats the index, complicates ranking (you get five near-duplicate hits in a row), and makes "show me products that match" much harder than "show me variants that match." Parent-document + variants-array preserves a clean product list and pushes the variation choice into the card.

**Why this sits in the proxy.** It needs the *full* document (not just the highlighted snippet) and the `_matchesPosition` map together. Meilisearch returns both — we just need to read them — but the projection from `(document, _matchesPosition) → matched_variation` is ~25 lines of TypeScript and we wanted it server-side rather than in the WordPress plugin (PHP) because the same logic will be reused by our future in-browser widget and by a React Native client.

**What would replace this in Meilisearch.** Probably nothing — this is genuinely application logic about *what to render* given a hit, not about *which hits to return*. The most we could imagine is a Meilisearch feature that "promotes" the best-matching subdocument inside a nested array, but it's narrow, and we'd still want the full variant object client-side anyway. We're calling this out so we don't pretend the proxy could disappear *entirely* — it could at most shrink to this ~25 lines of pure logic, possibly running on Cloudflare Workers next to the index.

---

### 6. Observability: per-request query log + live tail UI

**What it does.** Every request — success *and* every denial (origin not authorized, instance inactive, rate limited, Meilisearch failure) — appends a row to a `query_log` Postgres table with:

- query text
- HTTP status + denial reason
- total hits returned
- Meilisearch processing time
- total handler time
- origin host
- the **returned product IDs and names** (so we can answer "WP says no results, but our log says we returned 12 hits — is the plugin filtering them?")
- variant selection result per hit

`/configuration/search` in the GroLabs admin shows a live tail of this log, polling every 2 seconds. Operators (us, plus eventually merchants) use it to debug:

- "Why does my search box say no results?" → log shows we returned 5, plugin must be filtering
- "Why is search slow?" → split between handler time (us) and Meilisearch processing time (you), so we can tell whose fault it is
- "Did the plugin actually try to call us?" → if there's no log row, it didn't
- "Is the origin allowlist correct?" → denial rows show the exact host that was rejected

The log is the **single most important debugging surface we have** for a feature that touches three separate systems (WP plugin, our proxy, Meilisearch Cloud). When a merchant says "search is broken," the first thing we check is the log.

**Why this sits in the proxy.** We have to see the request and the response to log them. Meilisearch's analytics show us *Meilisearch's* view (queries that reached the index, processing times, popular searches) but they don't show:

- Requests that were rejected before reaching Meilisearch (rate limit, bad origin, inactive tenant)
- The product IDs we actually handed back to the plugin
- Total handler time including network + our work
- Per-tenant breakdown without us re-tagging queries

**What would replace this in Meilisearch.** A few things would have to land together:
- Per-key request log accessible via API (not just the dashboard), with the request body, response summary (hits returned, IDs), and timing
- Rejection events in that same log (rate limit / origin denial as first-class entries, not silent drops)
- Webhook or streaming output so we can mirror to our own DB for the operator UI

Honestly we'd probably keep mirroring to our DB regardless, because the live-tail UI needs to be embeddable in our own admin without an extra Meilisearch credential. But if the *source* of those events were Meilisearch, we could thin the proxy to a forwarder.

---

### 7. Operator-only search preview (separate auth path)

**What it does.** On `/configuration/search` there's a search box that runs against the same instance index, but authenticated via Supabase session (the operator is an authenticated `instance_member`), not via the public `instance_id`/origin flow. It bypasses rate limiting and `query_log` writes. It also computes, for each hit, **per-token match pills**: for the query `"red small sweater"`, three pills appear on each hit, each green or red depending on whether Meilisearch highlighted that token in any of the hit's searchable attributes — with the attribute path as a tooltip (`red · color`, `small · variants → size`).

This is how we (and merchants) verify that a result actually matched all the words a shopper typed, instead of just being Meilisearch's best guess. Typo tolerance, synonyms, and one-strong-token-dragging-the-rest are exactly the relevance pathologies that this view exposes.

**Why this sits in the proxy.** Same reasons as §5 + §6: it depends on `_matchesPosition`, on a friendly mapping from attribute paths to merchant-readable labels, and on rendering inside our admin shell.

**What would replace this in Meilisearch.** The Cloud dashboard has a search playground, but: (a) it's not embeddable in our admin, (b) it doesn't show the per-token match attribution we built, (c) it doesn't let *merchants* (non-Meilisearch users) see their own data, (d) it doesn't have our auth model. We can't move this one — but it's a small fraction of the proxy code and doesn't sit on the storefront hot path, so it doesn't matter for the latency conversation.

---

### 8. Document enrichment and the indexing pipeline

**What it does.** GroLabs is the canonical product database, not WooCommerce. We pull WooCommerce's catalog into our own Postgres (`product`, `product_variant`, `product_pricing`, `product_category_link`, `product_media`), enrich it (HTML stripping, computing `variation_summary`, normalizing variant attribute keys to WooCommerce taxonomy slugs like `pa_size` instead of localized display names, joining brand/categories, computing the canonical URL), and *then* push the enriched document to Meilisearch. The WordPress plugin never writes to Meilisearch. The merchant never writes to Meilisearch.

**Why.** Two reasons. First, our enrichment is not stable yet — it'll grow into the agent-driven attribute extraction (taking "Royal Canin Puppy Medium Breed 4kg" and proposing `{lifestage: puppy, breed-size: medium, weight: 4kg}` as structured attributes) that's the actual product moat for GroLabs. We need a place to run that pipeline that isn't inside Meilisearch. Second, we serve more than search out of the same canonical catalog — pricing, dashboards, sync to other channels — and we don't want each of those to re-derive enriched fields from WooCommerce.

**What would replace this in Meilisearch.** Nothing, deliberately. This is upstream of Meilisearch and we don't want to move it. It also doesn't sit on the search hot path (it runs on writes), so it's not relevant to the latency conversation. We're listing it for completeness.

---

### 9. Per-instance settings management (Stage 5, not built yet)

**What it does (planned).** Synonyms, stop words, ranking rule overrides, and faceting configuration become merchant-editable through `/configuration/search`. Today these are all defaults — Spanish stop words, no synonyms, the ranking rules in policy §3 — applied at index creation. Stage 5 is when the merchant gets a UI.

The synonym story matters most: synonyms start *empty per tenant* and accumulate through a feedback loop where (a) we detect zero-result queries from the query log (§6), (b) an agent proposes a synonym, (c) the merchant approves it through our admin UI, (d) we push the synonym to Meilisearch via the master key. This is the customer-visible value loop we're building search around.

**Why this sits in the proxy.** It doesn't really — the proxy is the *read* path, this is on the *write* path. But it shares the master-key client with the proxy (`src/lib/search/meilisearch-client.ts`) because both need admin-level access. We're calling it out because if Meilisearch ever offered "let the merchant edit synonyms with their own publishable key" we'd want to know.

**What would replace this in Meilisearch.** Settings access scoped to a non-master key, so we could either (a) hand merchants a key and let them edit directly, or (b) keep our UI but stop using the master key. We don't strictly need this — the master key flow works fine — but it'd cut surface area.

---

## What the proxy explicitly does *not* do

For completeness, so it's clear we're not hand-waving past hidden complexity:

- **No query rewriting.** The query string from the plugin goes to Meilisearch unchanged. We don't do stemming, synonym expansion, language detection — Meilisearch does all of that.
- **No result reranking.** Whatever order Meilisearch returns hits in, we preserve. The `matched_variation` field is decoration on the hit, not a reorder.
- **No caching of search results.** Every request hits Meilisearch.
- **No request fan-out.** One inbound request → one outbound Meilisearch call.
- **No business logic beyond §5.** No price arithmetic, no permission filtering beyond §4's filter pinning.

This is intentional. We wanted the proxy to be *boringly thin* so the round-trip cost is dominated by network, not by code.

---

## Latency budget today (rough)

From traces in `query_log.total_handler_ms` vs `processing_time_ms`:

- Meilisearch processing time: typically 5–40 ms
- Total proxy handler time (incl. Meilisearch round-trip): typically 60–180 ms
- Implied proxy overhead + WP→GroLabs network: 50–150 ms

The proxy itself is cheap. Most of the gap is the extra network hop — WP plugin → Vercel (`grolabs.com`) → Meilisearch Cloud (`us-east`) vs. what could be WP plugin → Meilisearch Cloud directly. That's the latency the merchant feels, and that's what we'd like to claw back.

---

## What we'd give up (and what we wouldn't) if the WP plugin called Meilisearch directly

If you took all of §1–§4 from us tomorrow:

**Could disappear:** the proxy as a hot-path service. We'd keep the master-key client, the indexing pipeline (§8), the query log + admin UI (§6), the preview pane (§7) — none of which sit on the shopper's request.

**Would still need to stay in some form:**

- The `matched_variation` projection (§5) — but this is ~25 lines and could move to a Worker, or to the plugin, or even to a Meilisearch hook if you ever offer one
- The query log mirror for the live-tail UI (§6) — but if Meilisearch exposed per-key request events with rejected-request entries, this becomes a passive sync rather than a synchronous write

**The minimum Meilisearch primitive we'd need** to make this trade is essentially: **a public per-index key with an origin allowlist, per-(key, origin) rate limiting, and request events visible to the account owner (including rejections).** Tenant tokens already cover scoping; the gap is the public-identity story and the per-key rate limit.

---

## Asks / questions for the Meilisearch team

In rough order of impact for collapsing the hop:

1. **Origin-bound public keys.** Is there (or could there be) a key type that's safe to ship in a WordPress plugin or browser bundle — scoped to one index, no admin, with an origin allowlist enforced at the Cloud edge?
2. **Per-key rate limiting in the control plane.** Per-IP and per-(key, origin) buckets, configurable by us, so we can hand keys to merchants without worrying about runaway loops.
3. **Per-key request log via API.** Including rejected requests (rate-limit, origin-deny), with response IDs and timing — so we can mirror to our DB and keep our operator UI without sitting on the request path.
4. **Generic-error policy.** A documented commitment that key-validation failures, origin failures, and "no such index" all return identical error bodies (no enumeration leak).
5. **`matched_variation`-style hint** (lowest priority). A response field that identifies the best-matching nested-array element per hit. Would let us drop §5 entirely. Not blocking — we're happy to keep this client-side.

If 1–4 land, we collapse the proxy on the read path and the WordPress plugin can call you directly. We keep GroLabs as the indexing pipeline + admin + analytics layer, which is where the product value is anyway.

---

## Open questions about Cloud analytics

Separate from the proxy-architecture conversation above — these are questions about the analytics surface in Meilisearch Cloud itself. What we have in place today: the search proxy returns `metadata.queryUid` from Meilisearch on every response, and the storefront posts click events directly to Meilisearch's `/events` endpoint (authenticated via a short-lived events token minted by `/api/v1/events/token`) so each click is attributed to the exact query. We're trying to build merchant-facing analytics on top of that and we keep hitting the same wall: **the dashboard shows aggregate numbers, and we need to slice them.**

The questions below are roughly ordered from concrete-and-immediate to bigger-picture.

### Q1. The "See queries" button under No-results rate doesn't do anything

In the Cloud analytics dashboard, the No-results rate card has a "See queries" action. Clicking it produces no visible response — no panel opens, no navigation, no network request that we can see in DevTools. Is this a known bug, an entitlement we don't have on the Build plan, or are we missing something in the UI?

This is the single most actionable metric for us — every zero-result query is a synonym-proposal opportunity in our merchant loop (see `search-foundations.md` §3 "Synonym strategy") — so being able to enumerate the actual queries behind that number is the first thing we'd want to wire up.

### Q2. Per-keyword click-through rate

We can get an aggregate CTR for the index, but we'd like to answer: **for the keyword `"royal canin puppy"`, what's the CTR over the last 30 days?**

What's the right way to compute this from Meilisearch today? Options we've considered:

- Group click events by their `queryUid`, join back to the originating query string — but we don't know if `queryUid` → query string is queryable, or if we have to keep that mapping ourselves on the proxy side.
- Use the analytics API (if there is one beyond the dashboard) to list queries with their impression count + click count.
- Treat `metadata.queryUid` as opaque and compute CTR ourselves from the proxy's `query_log` + a click_log we'd add.

Is there a sanctioned path, or are we expected to keep our own query/click counters?

### Q3. Per-keyword conversion rate

Same shape as Q2 but for purchase rather than click. We can fire a "conversion" event from the WP checkout against the same `queryUid` that produced the click that led to the purchase. The questions are:

- Does Meilisearch's `/events` endpoint accept a `conversion`-type event today, or only `click`? (The docs we've found describe clicks; we haven't seen a conversion event shape.)
- If yes, can we read back per-query conversion rates the same way we'd read CTR?
- If no, is there a recommended pattern — fire it as a click with a `type: 'conversion'` payload, attach it to the order, something else?

### Q4. Per-product CTR / avg-click-position / conversion rate

For each *returned document*, not just each query: **for product `id=12345`, when it appeared in results, how often was it clicked, at what average position, and how often did the click convert?**

This is what we need to drive the "your worst-performing product cards" merchant view — "Product X shows up in 200 searches a week and gets clicked 4 times" is exactly the signal that tells the merchant their card title or image is wrong, separately from whether search itself is working.

Does Cloud expose per-document metrics, or do we have to derive them from the raw event stream?

### Q5. Drilling generic metrics down to keyword + product cohorts

The headline metrics in the dashboard (CTR, average click position, conversion rate, no-results rate) are computed across *everything*. What we actually need to ship to merchants is the ability to filter or group those same metrics by:

- **Specific keyword** ("how is `royal canin puppy` doing this month vs last month?")
- **Set of keywords** ("how is the cohort of dog-food queries doing?")
- **Returned product or set of products** ("how is this catalog category doing?" — by mapping category → product IDs on our side, then asking Meilisearch for metrics filtered to clicks on those product IDs)
- **Time window** (last 7d / 30d / since deploy of new ranking rules)

The category case is the one we care about most. Concretely: a merchant invests effort in improving the catalog for one category (better titles, better attributes, more synonyms). They want to see that *category's* CTR and conversion rate go up, not just the global numbers — because global numbers move slowly and noisily, and the improvement might be invisible underneath noise from unrelated categories.

Two ways this could work:

- **Filter on the read side.** Cloud's analytics API accepts a filter (e.g. `category_ids = 47`) and returns metrics restricted to events whose hit-or-clicked document matched that filter. We don't believe this exists today — confirm?
- **Raw event export.** Cloud exposes the underlying event stream (impressions, clicks, conversions, each with `queryUid`, `documentId`, `position`, timestamp, and any tags we attached at search time). We'd do the cohort math ourselves in our DB. This is fine for us if event export is available and complete.

Either path works; we just need to know which one you'd point us at.

### Q6. Attaching our own tags to a search request for later cohorting

Related to Q5: at search time, can we attach an opaque tag (or a small bag of tags) to a query that propagates onto the analytics events derived from it? E.g. we tag a search with `experiment: 'ranking-v2'`, `category: 'food'`, `device: 'mobile'`, and later we can group click/conversion rates by any of those tags.

This is the standard A/B-testing primitive — without it, every experiment we want to run needs us to keep our own attribution table (queryUid → tags) on the proxy side and join it against your event log. We can do that, but if Cloud already supports query-time tagging we'd rather use it.

### Q7. Event retention and historical comparison

How far back do click/impression/conversion events go in Cloud, and is that configurable on our plan? "Did this category improve month-over-month after a catalog change three months ago" requires at least 90–120 days of retained events. If the retention is shorter on Build tier, we'll need to export to our own warehouse from day one, which is fine — but we want to know now rather than discover it later when a merchant asks for a 6-month trend.

### Why we're asking all of this in one place

The honest answer is that the proxy-collapse conversation (sections 1–9 above) and the analytics-drilldown conversation here are the same conversation: we built the proxy partly because we don't yet trust that Meilisearch will give us the per-tenant, per-keyword, per-product visibility our merchants need. If Cloud's analytics already supports the drilldowns in Q1–Q7, that's another reason for us to lean on it harder and keep the proxy thinner. If the drilldowns aren't there yet, we'll keep accumulating analytics in our own `query_log` table — which is fine, but means our proxy stays on the hot path longer, because we have to see the request to log it.

Happy to walk through any of this on a call.
