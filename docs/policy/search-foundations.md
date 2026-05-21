GroLabs Search Foundations — Stages 0 & 1

> **Editor's note:** Reshaped 2026-05-17 to conform to Constitution Articles 1 and 12. Previous version contained pet-specific assumptions baked into core search defaults.
>
> **2026-05-20 addendum:** Analytics scaffolding shipped ahead of the formal Stage 4. See §16 — the WP plugin now posts both click and conversion events to Meilisearch `/events` directly (CTR + conversion rate visible in the Meilisearch Cloud dashboard), and a self-contained block bench at `src/components/analytics/` surfaces what `query_log` and Meilisearch `GET /stats` can derive. Remaining Stage 4 scope is Scout-owned event persistence (for retention beyond Meilisearch's 7-day Build-tier window) and metrics Meilisearch exposes only in its dashboard UI.
>
> **2026-05-20 addendum (facets + in-Scout emulator):** Faceted refinement is being proven inside Scout *before* widening the WP plugin contract. See §17 for the facets evaluation plan, the search-proxy contract change, and the three-tab restructure of `/configuration/search` (Configuration / Analytics / Emulator). The emulator uses the same Meilisearch client path the public proxy uses — same documents, same filter pinning — so behaviour parity is mechanical, not aspirational. The public `/api/v1/search` contract gains `facets[]` + `facet_stats` in the response now so the plugin can adopt at its own cadence.

Status: Active policy Owner: Tuncho Scope: Stages 0 and 1 of the GroLabs search roadmap. Foundations and basic search live on Wazú. Audience: Claude Code (primary), future GroLabs contributors (secondary)
This document is the authoritative spec for the foundational search infrastructure. Read this before writing any code, viewing the file tree, or proposing implementation details. Stop at the two checkpoints marked APPROVAL REQUIRED and wait for explicit approval before proceeding.
1. Goals and non-goals
Stage 0 goals
Establish infrastructure plumbing so all subsequent stages compose cleanly. No user-facing changes. No shoppers see anything different yet.

* Provision Meilisearch Cloud project for production use.
* Add `instance.storefront_domains text[]` column — required by the token endpoint's origin validation.
* Implement GroLabs-side `meilisearch_client` module for admin operations (index management, document upserts, settings).
* Implement token-issuing endpoint that exchanges a GroLabs instance ID for a short-lived Meilisearch tenant token.
* Surface connection status in GroLabs admin under each instance's settings, with editor for `storefront_domains` and copy-to-clipboard for the Instance ID.
Stage 1 goals
Replace WooCommerce's default search with Meilisearch-powered search on Wazú. No frontend widget yet — when shoppers hit enter, they get faster, typo-tolerant, more relevant results in WooCommerce's existing search UI. Variable products show two-button cards that respect the shopper's expressed variant preference when matched.

* Implement the indexing pipeline: GroLabs pulls Wazú's catalog from WooCommerce REST API, runs GroLabs's enrichment, pushes enriched documents to Meilisearch.
* Implement WordPress plugin v0.1: settings page, instance ID validation, search query interception, two-button card rendering for variable products.
* Ship to Wazú in production.
Explicit non-goals for Stage 0+1

* No instant-results dropdown widget (Stage 2).
* No webhooks (Stage 3 — polling is sufficient).
* ~~No click/conversion event tracking (Stage 4).~~ **Superseded** — Stage 4 shipped in plugin v0.3.0 (clicks) and v0.5.0 (conversions). See `search-events.md` for the canonical flow. The token endpoint at `/api/v1/events/token` mints short-lived Meilisearch tenant tokens that the storefront uses to POST events directly to Meilisearch's analytics API. Scout itself does NOT persist events — they live exclusively in Meilisearch Cloud's analytics dashboard. A code session looking at Scout's DB and not finding an `events` table is correct; that's by design.
* No merchant-facing search configuration UI beyond connection status (Stage 5).
* No natural-language search (Stage 6).
* No agent insights surfaced to merchants (Stage 7).
* No support for ecommerce platforms other than WooCommerce.
2. Architectural decisions (locked)
These decisions have been made. Do not relitigate them. If implementation reveals a fundamental flaw, raise it as a question rather than working around it.
Meilisearch Cloud over self-hosted. No infrastructure operations burden. Build tier ($30/month) covers Stages 0-4 comfortably.
Single Cloud project, indexes per instance. All GroLabs instances live in one Meilisearch Cloud project named `scout-production`. Each instance gets its own index named `inst_<instance_id>`.
Per-instance index, NOT shared index with tenant token filtering. Despite Meilisearch's general recommendation for SaaS, GroLabs uses per-instance indexes because: (a) per-instance settings (synonyms, stop words, ranking) are a Stage 5 requirement, (b) merchant-level isolation is operationally simpler for support and debugging, (c) at GroLabs's scale (target 100s of merchants, not millions), the performance penalty is negligible. Revisit at customer #100+ if performance becomes an issue.
GroLabs owns Meilisearch keys end-to-end. Merchants paste only an instance ID into the WordPress plugin. The plugin calls GroLabs's API to obtain a short-lived tenant token. The Meilisearch master key never leaves GroLabs's backend.
GroLabs is the canonical product database, not WooCommerce. WooCommerce holds the storefront-visible subset. GroLabs holds the enriched catalog (normalized attributes, computed product tags, and any template-defined catalog attributes). For overlapping fields (name, price, stock), WooCommerce is the source of truth. For GroLabs-specific fields, GroLabs is the only source. Meilisearch indexes the enriched record.
No webhooks in Stage 1. Polling-based sync every 5 minutes. Webhooks come in Stage 3.
Search query interception, not GroLabs-controlled results page. Stage 1 intercepts WordPress's search query before WP_Query runs and rewrites it to use Meilisearch results, preserving the merchant's WooCommerce theme for the search results display.
One document per parent product. Variable products are indexed as a single document with a `variants` array containing all variation data. Variation attributes are searchable via Meilisearch's nested field support. The variations-as-separate-documents model is explicitly rejected — the parent-level approach with the two-button card UX covers shopper needs, and the data structure is simpler to reason about.
Variation matching uses Meilisearch's match positions, not custom query parsing. When a query matches specific variant attributes within a document, GroLabs's API reads `_matchesPosition` to identify which variant ranked highest within that document. This becomes the `matched_variation` for the search result card. No regex-based query parser, no per-merchant attribute name configuration, no Spanish/English size-word matching code. Meilisearch's relevance scoring does the work.
Two-button card UX for variable products. When a query matches a specific variation within a parent product, the search result card shows two actions: a primary "Agregar [variant] al carrito" button using the matched variation's ID, and a secondary "Ver otros tamaños" link to the product page. When no specific variation matches, the card shows a single "Elegir tamaño" button. Simple products and single-variation products show a standard "Agregar al carrito" button.
Multi-tenancy boundary uses `instance_id`, consistent with all other GroLabs tables.
3. Meilisearch Cloud setup
Project configuration

* Project name: `scout-production`
* Region: closest to merchant traffic; default `us-east` for now
* Plan: Build ($30/month) at launch
* Master API key: stored in GroLabs backend env var `MEILISEARCH_MASTER_KEY`
* Project URL: stored in `MEILISEARCH_HOST`
* Analytics and monitoring: enabled (free at all tiers)
Index naming convention
`inst_<instance_id>` where `instance_id` is the integer primary key from GroLabs's `instance` table (note: singular table name, consistent with all other GroLabs tables — see CLAUDE.md §2). The template instance has `instance_id = 0`; that's a valid value, not a falsy sentinel — never use `if (!instanceId)` checks.
Index settings defaults (applied at creation)
The `searchableAttributes` MUST include `variants.attributes` and `variants.sku` to enable nested-field matching for variation queries. Spanish stop words are baked in as defaults; synonyms start empty per tenant (see "Synonym strategy" below). Stage 5 will let merchants override stop words per-instance. Typo tolerance enabled with `oneTypo` at 4 chars and `twoTypos` at 8 chars. Faceting max 100 values per facet. Pagination max 1000 hits.
Searchable attributes: `name`, `brand`, `categories`, `description`, `variants.attributes`, `variants.sku`, plus whatever template-defined catalog attributes the tenant's catalog exposes (see "Catalog attributes" below).
Filterable attributes: `instance_id`, `category_ids`, `brand`, `in_stock`, `price`, plus template-defined catalog attributes exposed as facets (see "Catalog attributes" below).
Sortable attributes: `price`, `created_at`, `popularity`.
Ranking rules (in order): `words`, `typo`, `proximity`, `attribute`, `sort`, `exactness`, `popularity:desc`.
Stop words (Spanish): `el`, `la`, `los`, `las`, `un`, `una`, `de`, `del`, `para`, `con`, `y`, `o`.
### Synonym strategy

Synonyms start empty per tenant. They are accumulated through the zero-result-query → agent-proposes → merchant-approves loop. No vertical ships default synonyms; the recovery moment (turning a zero-result query into a working synonym) is part of the customer-visible value loop and would be diluted by pre-seeded content.
4. Document schema
The schema for documents indexed in Meilisearch.
Identity fields: `id` (GroLabs's internal product ID), `instance_id` (defense-in-depth filter), `woocommerce_id` (WC post ID).
Display fields from WooCommerce: `name`, `slug`, `description` (HTML stripped), `short_description`, `url` (computed), `image_url`, `thumbnail_url`.
Categorization from WooCommerce: `categories` (names), `category_ids` (WC term IDs), `tags`, `brand`.
### Catalog attributes

Attributes are owned by the Catalog module (Module Map §3). The generic attributes system handles all vertical-specific attribute definitions through templates (pet-shop template defines breed-size, lifestage, etc.; jewelry template defines carats, cut, clarity; electronics template defines wattage, form-factor). Core search indexes whichever attributes the tenant's catalog defines.
Variation summary under `variation_summary`: `type` (`'simple'` | `'variable_single'` | `'variable_multi'`), `purchasable_variation_count`, `default_variation_id`, `default_variation_sku`, `price_range` (`{min, max}`), `in_stock_summary` (`{any_in_stock, all_in_stock}`).
Variants array — each entry contains: `variation_id`, `sku`, `attributes` (Record<string, string>), `price`, `sale_price`, `in_stock`, `stock_quantity`, `image_url`.

**Attribute key convention.** Keys in `variants[].attributes` MUST be the WC taxonomy slug (e.g. `pa_size`), NOT the human-readable name (`Tamaño`). Slugs are stable identifiers — names get localized and renamed. The WordPress plugin uses these keys to build add-to-cart URLs of the form `?attribute_pa_size=4kg`, which only works with slug keys.
Top-level commerce mirrors: `price` (for variable products equals `price_range.min`), `sale_price`, `currency`, `in_stock`, `sku`.
Other: `popularity` (default 0, populated in Stage 4), `created_at`, `updated_at`, `indexed_at`, `_schema_version: 1`.
Field source rules

* WooCommerce-sourced fields: WooCommerce REST API is source of truth. GroLabs reads, never writes back.
* GroLabs-enriched fields (template-defined catalog attributes): GroLabs is the only source.
* Computed fields (`url`, `popularity`, `variation_summary`): Computed at indexing time.
* HTML stripping: `description` and `short_description` must have HTML tags stripped.
variation_summary computation rules

* `type: 'simple'`: WooCommerce product type is `simple`.
* `type: 'variable_single'`: Type is `variable` AND exactly one variation is published, in_stock, and visible.
* `type: 'variable_multi'`: Type is `variable` AND two or more variations are purchasable.
* `default_variation_id`: For `simple`, the parent product ID. For `variable_single`, the one purchasable variation. For `variable_multi`, the variation marked default in WooCommerce, falling back to the first in-stock variation if no default is set, falling back to null if nothing is in stock.
5. GroLabs backend — `meilisearch_client` module
Stage: 0.
Module location: `src/lib/search/meilisearch-client.ts`. This is the only place in GroLabs's codebase that holds the Meilisearch master key.
Required interface includes index lifecycle (`createIndex`, `deleteIndex`, `indexExists`), settings management (`applyDefaultSettings`, `updateSettings`, `getSettings`), document operations (`upsertDocuments`, `deleteDocument`, `deleteAllDocuments`, `getDocumentCount`), search (with `showMatchesPosition: true` requested — verify exact option name in current SDK), token generation, and health (`ping`, `getTaskStatus`).
Implementation requirements: use the official `meilisearch` npm package (latest stable); never log the master key; wrap Meilisearch errors with GroLabs-specific context; all write operations return `TaskInfo` for tracking; search operations request match positions for the variant selection logic.
Token generation specifics
Tenant tokens for `instance_id` X include this filter as defense-in-depth:

```typescript
const searchRules = {
  [`inst_${instanceId}`]: {
    filter: `instance_id = ${instanceId}`
  }
};

```

`instance_id` is a number — the filter value is unquoted. Meilisearch's filter DSL distinguishes numeric from string equality.

Tokens expire in 15 minutes by default.
6. GroLabs backend — token-issuing API endpoint
Stage: 0.
Endpoint: `POST /api/v1/search/token`
Request body: `{ instance_id: number }`. Origin header required.
Success response: `{ token, expires_at, meilisearch_host, index_uid }` with `Cache-Control: no-store`.
Error response (instance unknown OR origin not registered): 403 with generic message `instance_not_found_or_origin_not_authorized`. Error responses MUST NOT distinguish between the two cases (prevents enumeration).
Validation: `instance_id` parses as a non-negative integer (note: 0 is valid — the template instance); instance must exist and be `active` in the `instance` table; origin must be in `instance.storefront_domains`; rate limit 60/min per (instance_id, origin), 600/min per IP, both → 429; CORS echoes Origin if validated, never `*`.
Trust model: instance_id is public (like a Stripe publishable key). Origin validation is the security boundary. Rate limiting prevents abuse. No auth header from the WordPress plugin in Stage 1. Future hardening (Stage 4+) adds HMAC signature with per-instance secret.
7. GroLabs backend — search proxy endpoint
Stage: 1. The WordPress plugin calls this endpoint, so it lands in the same stage as the plugin.
Endpoint: `POST /api/v1/search`. The middle-layer endpoint the WordPress plugin calls. Proxies to Meilisearch with server-side tenant token management and adds the variant selection logic.
Request: `{ instance_id, query, limit, offset, filters, sort, facets? }`. Response: `{ hits[], total_hits, processing_time_ms, query_uid, facets?, facet_stats? }` where each hit is `{ document, matched_variation, _score }`.

**Facets contract (added 2026-05-20).** Callers can request facet distribution and stats by passing a `facets: string[]` array. Server enforces a per-instance allowlist (currently: `brand`, `category_ids`, `in_stock`, `price`, `scout_attributes.species`, `scout_attributes.lifestage` — must be a subset of the index's `filterableAttributes`). Unknown facet names are silently dropped; an empty array (or omitted) returns no `facets`/`facet_stats` blocks. The response carries:

* `facets: Record<string, Record<string, number>>` — value → count per facet name. Counts respect any active `filters`, i.e. they're restrictive (Meilisearch default). Disjunctive facet behaviour (Algolia-style "all values, counts respect remaining filters") is explicitly out of scope for this iteration — it costs N+1 queries and isn't needed until merchants have UIs that benefit from it.
* `facet_stats: Record<string, { min: number, max: number }>` — emitted only for numeric facets where Meilisearch returned stats (today: `price`).

Facet *labels* are not translated by the proxy. Per CLAUDE.md §5, data labels come from the DB, never from Scout-side i18n. The proxy returns raw facet values (brand names, category IDs); the consumer renders.

**`matched_variation` shape.** When non-null, `matched_variation` is a **full variant object** matching the exact shape of entries in `document.variants[]`: `variation_id`, `sku`, `attributes` (Record<string,string> with slug keys per §4), `price`, `sale_price`, `in_stock`, `stock_quantity`, `image_url`. Not just a `variation_id` reference — the whole object, so the plugin can render a card without a second lookup. `null` for `simple` products and for `variable_multi` products with no in-stock variation found.
Variant selection logic
For each Meilisearch hit, compute `matched_variation`:

* If `document.variation_summary.type == 'simple'`: `matched_variation = null` (card uses document's top-level fields).
* If `'variable_single'`: `matched_variation` = the one purchasable variation.
* If `'variable_multi'`: read Meilisearch's `_matchesPosition`. Count matches per variant index in the `variants` array. Pick the in-stock variant with the most matches. If no variant had specific matches, fall back to `default_variation_id` (if in stock), then to first in-stock variant, then to null.
This logic is roughly 15-25 lines of pure, unit-testable TypeScript.
Validation: validate `instance_id` and `Origin` exactly as token endpoint. Acquire tenant token internally (cached for TTL minus 1 minute). Forward search to Meilisearch with `showMatchesPosition: true`. Process with variant selection. Log query, total_hits, processing_time, variant selection result to `query_log` table.
8. GroLabs admin — instance search settings
Stage 0 ships connection panel + storefront-domains editor + Instance-ID copy. Stage 1 adds indexing status + reindex.
Page lives at `/configuration/search`, matching the existing pattern at `src/app/[locale]/(app)/configuration/<integration>/page.tsx` (see `/configuration/algolia` and `/configuration/woocommerce`). The current instance is resolved from the JWT via `currentInstanceId()`, not from the URL.
Stage 0 deliverables: connection status panel (green/red), storefront domain registration field (stored in `instance.storefront_domains` text array), plugin instructions with copy-button for Instance ID.
Stage 1 deliverables: indexing status panel (last sync, document counts, mismatch detection), manual reindex button with confirmation modal, WooCommerce credentials form (REST API URL, consumer_key, consumer_secret).
No search behavior configuration in Stage 1 — that's Stage 5.
9. Stage 1 — Indexing pipeline
The pipeline reads from **GroLabs's `product` / `product_variant` / `product_pricing` / `product_category_link` / `product_media` tables**, not from WooCommerce directly. Per §2's locked decision, GroLabs is the canonical product database; the WooCommerce → GroLabs pull is a separate process documented in `docs/policy/wc-import.md`. Meilisearch is fed from GroLabs.

Trigger: synchronous push from product/variant/pricing server actions. Any mutation that successfully writes to GroLabs fires `indexProduct(instance_id, product_id)`. A manual full-instance backfill is exposed in the admin panel (`runFullBackfill(instance_id)`). Scheduled cron polling is deferred — GroLabs is the write path, so app-layer hooks are sufficient at v1 scale. (Future: queueing + Vercel cron for instances that bypass GroLabs's mutation surface.)

Flow per indexed product: load product + variants + pricing + categories + media in one query batch; build the §4 document (HTML-stripped, `variation_summary` computed, `variants[]` populated with slug-keyed attributes per the locked contract below); upsert to Meilisearch; write `product_sync_status` row with `platform = 'meilisearch'`; on a backfill run, also append a `sync_log` entry.
Initial full backfill iterates all `is_active` products for the instance, paginated 100/page.
Failure modes: Meilisearch upsert fails → log task UID in `product_sync_status.last_error`, retry next mutation. Schema validation fails → write to `failed_indexing` table, skip. Single product build fails → log, skip, continue batch.
Stage 1 enrichment scope is intentionally minimal — NOT the 7-agent pipeline. It strips HTML from descriptions, sets `popularity: 0`, computes `variation_summary`, populates `variants` array.

Lifestage detection has been removed from core search foundations. Lifestage, like any other domain-specific concept, is expressed as a catalog attribute configured by the relevant template. Search treats it as a normal facet.

### Attribute extraction from product names

Attribute extraction is an industry-agnostic agent capability (Module Map §14, Optimization Agent). The agent reads a product's name and proposes attribute values for the attributes defined on that product's category. The agent does not know or care which vertical it operates in — it operates on whatever attribute schema the template defines.

Examples across verticals:
- Pet-shop: 'Royal Canin Puppy Medium Breed 4kg' → proposes {lifestage: puppy, breed-size: medium, weight: 4kg}
- Jewelry: '1.5ct Round Brilliant Diamond VS1' → proposes {carats: 1.5, cut: round-brilliant, clarity: VS1}
- Electronics: 'Dell XPS 13 9320 i7 16GB 512GB' → proposes {brand: Dell, model: XPS 13 9320, cpu: i7, ram: 16GB, storage: 512GB}

This capability is invoked by Catalog workflows (on import, on demand, on background sweep) and by Sync (first-sync probe). The agent module owns the function; the calling module owns the workflow context.

The attribute-based product-customer matching feature (the dropped bridge table's intended purpose) is a separate future capability tracked in docs/backlog.md.

Locked variant contract (per PR #68, plugin v0.2 consumer):
* `document.variants[].attributes` keys MUST be slugs (e.g. `pa_size`), not display names. Use the WooCommerce taxonomy slug from `product.wc_raw.attributes[].slug` / `wc_raw.variations[].attributes[].slug`. Values stay as the human-readable option label (e.g. `"4kg"`).
* Search-proxy hits return `matched_variation` as a **full variant object** (same shape as entries in `document.variants[]`), not just a `variation_id` reference.

Variation handling specifics: include all variations including out-of-stock (the `in_stock` flag distinguishes); exclude inactive variations entirely.
10. Stage 1 — WordPress plugin v0.1
Distribution: `.zip` file from GroLabs's CDN. Not initially submitted to WordPress.org plugin directory. Auto-update mechanism out of scope for v0.1.
Plugin structure: `scout-search.php` (main file), `readme.txt`, `includes/` (settings, search, api, card classes), `admin/settings-page.php`, `assets/css/scout-card.css`.
Settings page (WordPress admin → Settings → GroLabs Search): single text input for GroLabs Instance ID, Test connection button calling GroLabs's `/api/v1/search/token`, Status display. On save: POST to GroLabs API, 200 → "Conectado", 403/404 → invalid ID/domain message, network error → connectivity message.
Search query interception via `pre_get_posts` when `is_search()` and product post type. Capture search term, call GroLabs's `/api/v1/search`, cache `matched_variation` map keyed by product ID in transient, override WP_Query with `post__in` and `orderby=post__in`. WordPress renders results via merchant's existing theme.
Search result card rendering: plugin overrides WooCommerce card on search results pages only (not category or other listings) via WooCommerce template hooks. Look up `matched_variation` from transient. For simple/variable_single: single "Agregar al carrito" button or "Agotado" badge. For variable_multi with matched variation in stock: two buttons stacked vertically on mobile — primary "Agregar [variant attributes] al carrito" with matched variation ID, displaying matched variation's price (not parent's range) and image (if different from parent); secondary "Ver otros tamaños" linking to product page. For variable_multi with no specific match but stock available: single "Elegir tamaño" linking to product page. All out of stock: "Agotado" badge.
Spanish wording (Latin American / Guatemalan): "Agregar al carrito", "Agregar [size] al carrito", "Ver otros tamaños", "Elegir tamaño", "Agotado", "Conectado", "ID de instancia inválido".
Failure mode: GroLabs API unreachable → fall back to WordPress's default search. Log to a WP option for diagnostic visibility. Never break the merchant's storefront.
Plugin settings storage: `scout_search_instance_id`, `scout_search_meilisearch_host`, `scout_search_index_uid`, `scout_search_last_token_check`, `scout_search_status`. Tokens in WP transients (14-min TTL). Search-results metadata in transients per request.
11. Test cases
Indexing pipeline tests: full sync completes with document count within 1% of WC product count; modified products propagate within 6 minutes; deletions propagate within 6 minutes; HTML stripped from descriptions; stock changes propagate; variable products index with full variants array; variation_summary type computed correctly for simple/variable_single/variable_multi cases.
Search behavior tests on Wazú: 20 representative Spanish queries with expected behaviors covering keyword search, synonym handling, typo tolerance, brand + attribute filtering, variation-specific matches (e.g., a query naming a specific variant attribute → that variation matched), broad queries, zero-result queries, empty query, stop word filtering, emoji input safety, XSS sanitization.
Variant matching tests: query matching specific variant attribute → correct `matched_variation`; query matching only parent → falls back to default_variation_id; matched variant out of stock → falls back to next in-stock variant; simple product → matched_variation is null.
Card rendering tests: simple+stock → "Agregar al carrito"; variable_single+stock → "Agregar al carrito" with variation ID; variable_multi+matched+stock → two-button layout; variable_multi+no match+any stock → "Elegir tamaño"; out of stock → "Agotado" badge; mobile (<768px) → two-button stacks vertically.
Token endpoint tests: valid request → 200; invalid ID → 403 generic; valid ID wrong origin → 403 generic; rate limit → 429; token authorizes search; token expires correctly.
Plugin tests: install + valid ID → "Conectado" within 10 seconds; invalid ID → clear error; search returns GroLabs-ranked results; deactivation reverts to WC default; uninstall removes all options cleanly; add-to-cart on matched-variation card adds correct variation ID.
12. APPROVAL REQUIRED — Checkpoint 1
Before writing any code, Claude Code must:

1. Confirm understanding of all decisions in this document.
2. Identify any ambiguities or contradictions and ask clarifying questions.
3. Propose the file tree for both the GroLabs backend changes and the WordPress plugin, listing every file that will be created or modified.
4. Wait for explicit approval of the file tree before writing any code.
13. APPROVAL REQUIRED — Checkpoint 2
After the file tree is approved and Claude Code has written the code:

1. Run all tests in section 11.
2. Report which tests pass and which fail, with reasons for any failures.
3. Wait for explicit approval before merging to main.
4. Open a PR; do not auto-merge. Tuncho reviews before merging.
14. Out of scope (later policy docs)

* Click and conversion event tracking → `search-events.md` (Stage 4). _Partially shipped — see §16._
* Webhooks for real-time sync → `search-webhooks.md` (Stage 3)
* Instant results dropdown widget → `search-widget.md` (Stage 2)
* Merchant-facing search configuration UI → `search-configuration.md` (Stage 5)
* Natural language search via Meilisearch Chat → `search-conversational.md` (Stage 6)
* Agent insights from search data → `search-agents.md` (Stage 7)

Out of scope for this policy (separate concerns, not part of search):

* Stock management — adding a `variant_stock` table, stock inline edit on the variant management screen, and any stock-source semantics. Search consumes `in_stock` / `stock_quantity` from whatever upstream source produces them; producing those values is a stock-policy concern, not a search-policy concern. Belongs in a future `inventory.md` or similar.
* `product_sync_status` schema additions for `platform='meilisearch'` are a Stage 1 implementation detail (handled by the push pipeline), not a Stage 0 prerequisite.
15. Resolved decisions
These open questions have been resolved through Tuncho's approval:

1. Currency: Indexed `price` is in merchant's native currency (GTQ for Wazú). No normalization.
2. Hidden/draft products: Only `publish` status indexed.
3. Variable products: One document per parent. Variations in `variants` array, indexed as searchable nested fields. Variant selection uses Meilisearch match positions.
4. Out-of-stock visibility: Out-of-stock products appear with "Agotado" badge, ranked lower via popularity.
5. Storefront domain registration: Domain field at instance creation, editable later. Multiple domains supported per instance.
6. Two-button card UX: Confirmed for variable products with matched variations. Primary "Agregar [variant] al carrito", secondary "Ver otros tamaños".
16. What's shipped beyond Stages 0 & 1

This section is an honest changelog, not new policy. It records work that landed after the original spec was written so future readers don't assume Stage 4 is empty.

**2026-05-09 — `queryUid` capture (Scout side).** `searchInstance` sends `Meili-Include-Metadata: true` on every search; `/api/v1/search` forwards `metadata.queryUid` / `requestUid` / `indexUid` to the storefront in the response body. See `src/lib/search/meilisearch-client.ts` and `src/app/api/v1/search/route.ts`.

**2026-05-09 — events token endpoint.** `POST /api/v1/events/token` mints a short-lived Meilisearch tenant token (CORS-gated to registered storefront domains, rate-limited) so the WP plugin can POST events directly to Meilisearch `/events` without involving Scout on the hot path. See `src/app/api/v1/events/token/route.ts`.

**2026-05-09 (plugin) — click + conversion events.** The WP plugin uses the events token to post both `click` and `conversion` events to Meilisearch. Confirmed live by the Cloud dashboard's non-zero CTR + conversion rate on 2026-05-20. Conversion is one-per-`queryUid` (Meilisearch's hard constraint).

**2026-05-20 — analytics block bench (this commit).** Self-contained portable blocks under `src/components/analytics/`, currently rendered at the bottom of `/configuration/search`. Each block takes only `instanceId` (plus optional `days`/`limit`) so blocks can be moved to `/dashboard` or an admin overview by changing only the import path. Data sources:

| Block | Source |
|---|---|
| SearchVolume, NoResultRate, Latency, TopQueries, TopNoResultQueries, StorefrontBreakdown | `query_log` (Scout, RLS-scoped to instance members) |
| IndexHealth, IndexSize, FieldDistribution | Meilisearch `GET /stats` |

**Known gaps that need a future Stage 4 doc to formalize:**

* Meilisearch exposes no read API for aggregated analytics (CTR, conversion rate, average click position, top queries from its side, geo). These stay Cloud-dashboard-only unless we own them.
* No Scout-side event store yet. If we need history beyond Meilisearch's 7-day Build-tier retention or breakdowns by `instance_id` / WC product type / funnel stage, the WP plugin needs to double-post to a new Scout endpoint that persists to Supabase. The wiring is in place: `queryUid` already crosses the Scout↔storefront boundary, so we only need the ingest endpoint and a target table.
* No Stage 4 policy doc exists yet (`search-events.md` is still referenced as future work in §14). Spec it out before building the event store.

17. Facets + in-Scout emulator (added 2026-05-20)

The decision recorded here: **prove faceted search inside Scout before broadening the WP plugin's UI to render facets.** The proxy gains the facets contract now (§7 amendment) so the plugin can adopt at its own cadence, but the first consumer is a staff-only emulator on `/configuration/search` that exercises the exact same Meilisearch path the storefront will hit.

### Why an emulator first

Storefront facet UIs are deceptively expensive — they bring in disjunctive-facet semantics, range sliders, filter-state serialization, and a plugin-side cache invalidation story. Building the merchant-facing surface inside Scout first means:

* The facets/filters contract gets a real consumer immediately, with stack traces and instant iteration, instead of waiting for a plugin release cycle.
* We see Meilisearch's `facetDistribution` / `facetStats` shape against real merchant data, not a fixture, before promising it to a third-party plugin.
* The per-attribute match highlighting work (§17.3 below) lands somewhere a CS engineer can use it during a support call — "show me what your customer searched and which attribute the match came from."

### `/configuration/search` becomes three tabs

The current page concatenates three concerns. Split:

| Tab | Contents | Source files |
|---|---|---|
| **Configuración** | Connection panel, Instance ID, storefront domains, index initialise, indexing status, reindex, request log, event log | existing `_form.tsx`, `_request-log.tsx`, `_event-log.tsx` |
| **Analytics** | All `src/components/analytics/*` blocks currently rendered at the bottom of the page | existing analytics components, unchanged |
| **Emulador** | NEW. Full-width search emulator: search box, category dropdown, facet rail, result cards with match highlights | NEW `_emulator.tsx` |

The existing inline `_search-preview.tsx` "Vista previa" pane on the Configuration tab is left in place — it's the quick-glance sibling of the full emulator, useful when checking connection health without leaving the Config tab. The emulator is the dedicated surface for actually exercising query → filter → facet → result flows.

### Emulator layout

Within the Emulador tab the full tab width is for the emulator:

```
┌──────────────────────────────────────────────────────────────────┐
│  [ search input — full width                  ] [ category ▼ ]    │
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                     │
│  Facets    │   Result cards                                      │
│  (left     │   (each card: image, name, price, in-stock,         │
│   rail,    │    matched attribute → highlighted tokens)          │
│   ~260px)  │                                                     │
│            │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

* **Search input** — debounced re-query. Empty query is valid (Meilisearch returns facets + first page of docs).
* **Category dropdown** — single-select. Source: `category` table where `is_active = true` for this instance. Selecting a category adds `category_ids = <id>` to the filter; clearing it drops the constraint. Hierarchical labels (`Root › Sub › Leaf`) for disambiguation when names repeat across branches.
* **Facet rail** — server picks which facet names to render from the allowlist intersected with what `facetDistribution` actually returned. Rail order is **deliberate, not alphabetical** and lives as `FACET_RENDER_ORDER` in `src/lib/search/facets.ts`:
  * `price` — two numeric inputs bound to `facet_stats.price.{min,max}` (pinned first)
  * `brand` — checkbox list, top N values by count (pinned second)
  * **Dynamic per-attribute facets** — one checkbox group per `product_attribute` row marked `is_filterable = true` AND `data_type = 'list'`. When a category is selected, the list is filtered + ordered by that category's `category_product_attribute.form_order`. Without a category, every filterable list-type attribute appears alphabetically. Indexed under `attributes.<attribute_code>`; the document builder emits this block from `product_attribute_value` joined with `product_attribute_option`. `ensureIndex` widens the index's `filterableAttributes` per-instance to include every `attributes.<code>` so Meilisearch will facet on them. **Reindex is required** after enabling a new attribute for filterability — the merchant clicks "Reindexar todo" on the Configuración tab.
  * `scout_attributes.*` legacy slots — checkbox list when present in the indexed data
  * `in_stock` — single toggle (boolean, pinned last)

Price + brand are the two dominant deciding factors per shopper research, hence the pinning. The dynamic block in the middle is where merchant-defined priority (`form_order`) takes over. `in_stock` is visual punctuation at the bottom.

**v1 scope: list-type only.** Text, number, and quantity attributes are NOT yet indexed under `attributes.*` — they need different widgets (autocomplete, numeric range, unit-aware range) and land in a follow-up. The document builder skips them; the server action filters them out of the dynamic attribute list.

**Attribute label translation.** Dynamic facet labels in the rail use the `product_attribute.attribute_name` column by default, but if a row exists in `product_attribute_translation` for the active locale (resolved server-side via `next-intl`'s `getLocale()`), that translation wins. NULL or empty translation rows fall through to the canonical name. The indexed Meilisearch document is locale-agnostic — the slug (`attributes.<code>`) is the stable identifier; label resolution is presentation-time, not index-time. No reindex needed when translations change.
* **Result cards** — same logical card as the storefront, plus a per-attribute match strip beneath the title. Each strip entry reads `<attribute name> — <token1>, <token2>` (e.g. `name — "royal", "canin"` / `description — "puppy"`). Built by walking Meilisearch's `_formatted` block per hit; reuses the helpers already proven by `_search-preview.tsx`.

### Wiring decisions

* The emulator does **not** call the public `/api/v1/search` endpoint. It is staff-only and authenticated by `instance_member`, so it goes through a server action (`runEmulatorSearch`) that calls `searchInstance(...)` directly. Same Meilisearch code path, no `Origin` validation gymnastics, no rate-limit counters polluted by admin testing.
* The category list is loaded once per page render (server component) and passed into the client emulator. Stale-by-a-page-refresh is fine — categories don't churn.
* Filter construction is shared between the public route and the emulator action via a small `buildMeilisearchFilter()` helper in `src/lib/search/facets.ts`, so the two surfaces can't drift on filter quoting / escaping.
* The facets allowlist also lives in `src/lib/search/facets.ts` as the single source of truth.

### Out of scope for this iteration

* **WP plugin facet UI.** The plugin will gain facet rendering in a follow-up release that consumes the now-stable proxy contract.
* **Disjunctive facets.** Restrictive (Meilisearch default) only.
* **Custom facet ordering / hidden facets per instance.** Comes with Stage 5's merchant search-config UI.
* **Per-facet i18n labels.** Data labels come from the DB; UI chrome around them (the section heading "Facets") goes through `t()`.

End of policy document. Start with Checkpoint 1 (section 12) before writing any code.
