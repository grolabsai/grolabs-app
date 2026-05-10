Scout Search Foundations — Stages 0 & 1
Status: Active policy Owner: Tuncho Scope: Stages 0 and 1 of the Scout search roadmap. Foundations and basic search live on Wazú. Audience: Claude Code (primary), future Scout contributors (secondary)
This document is the authoritative spec for the foundational search infrastructure. Read this before writing any code, viewing the file tree, or proposing implementation details. Stop at the two checkpoints marked APPROVAL REQUIRED and wait for explicit approval before proceeding.
1. Goals and non-goals
Stage 0 goals
Establish infrastructure plumbing so all subsequent stages compose cleanly. No user-facing changes. No shoppers see anything different yet.

* Provision Meilisearch Cloud project for production use.
* Add `instance.storefront_domains text[]` column — required by the token endpoint's origin validation.
* Implement Scout-side `meilisearch_client` module for admin operations (index management, document upserts, settings).
* Implement token-issuing endpoint that exchanges a Scout instance ID for a short-lived Meilisearch tenant token.
* Surface connection status in Scout admin under each instance's settings, with editor for `storefront_domains` and copy-to-clipboard for the Instance ID.
Stage 1 goals
Replace WooCommerce's default search with Meilisearch-powered search on Wazú. No frontend widget yet — when shoppers hit enter, they get faster, typo-tolerant, more relevant results in WooCommerce's existing search UI. Variable products show two-button cards that respect the shopper's expressed variant preference when matched.

* Implement the indexing pipeline: Scout pulls Wazú's catalog from WooCommerce REST API, runs Scout's enrichment, pushes enriched documents to Meilisearch.
* Implement WordPress plugin v0.1: settings page, instance ID validation, search query interception, two-button card rendering for variable products.
* Ship to Wazú in production.
Explicit non-goals for Stage 0+1

* No instant-results dropdown widget (Stage 2).
* No webhooks (Stage 3 — polling is sufficient).
* No click/conversion event tracking (Stage 4).
* No merchant-facing search configuration UI beyond connection status (Stage 5).
* No natural-language search (Stage 6).
* No agent insights surfaced to merchants (Stage 7).
* No support for ecommerce platforms other than WooCommerce.
2. Architectural decisions (locked)
These decisions have been made. Do not relitigate them. If implementation reveals a fundamental flaw, raise it as a question rather than working around it.
Meilisearch Cloud over self-hosted. No infrastructure operations burden. Build tier ($30/month) covers Stages 0-4 comfortably.
Single Cloud project, indexes per instance. All Scout instances live in one Meilisearch Cloud project named `scout-production`. Each instance gets its own index named `inst_<instance_id>`.
Per-instance index, NOT shared index with tenant token filtering. Despite Meilisearch's general recommendation for SaaS, Scout uses per-instance indexes because: (a) per-instance settings (synonyms, stop words, ranking) are a Stage 5 requirement, (b) merchant-level isolation is operationally simpler for support and debugging, (c) at Scout's scale (target 100s of merchants, not millions), the performance penalty is negligible. Revisit at customer #100+ if performance becomes an issue.
Scout owns Meilisearch keys end-to-end. Merchants paste only an instance ID into the WordPress plugin. The plugin calls Scout's API to obtain a short-lived tenant token. The Meilisearch master key never leaves Scout's backend.
Scout is the canonical product database, not WooCommerce. WooCommerce holds the storefront-visible subset. Scout holds the enriched catalog (lifestage, breed compatibility, species, normalized attributes, computed product tags). For overlapping fields (name, price, stock), WooCommerce is the source of truth. For Scout-specific fields, Scout is the only source. Meilisearch indexes the enriched record.
No webhooks in Stage 1. Polling-based sync every 5 minutes. Webhooks come in Stage 3.
Search query interception, not Scout-controlled results page. Stage 1 intercepts WordPress's search query before WP_Query runs and rewrites it to use Meilisearch results, preserving the merchant's WooCommerce theme for the search results display.
One document per parent product. Variable products are indexed as a single document with a `variants` array containing all variation data. Variation attributes are searchable via Meilisearch's nested field support. The variations-as-separate-documents model is explicitly rejected — the parent-level approach with the two-button card UX covers shopper needs, and the data structure is simpler to reason about.
Variation matching uses Meilisearch's match positions, not custom query parsing. When a query matches specific variant attributes within a document, Scout's API reads `_matchesPosition` to identify which variant ranked highest within that document. This becomes the `matched_variation` for the search result card. No regex-based query parser, no per-merchant attribute name configuration, no Spanish/English size-word matching code. Meilisearch's relevance scoring does the work.
Two-button card UX for variable products. When a query matches a specific variation within a parent product, the search result card shows two actions: a primary "Agregar [variant] al carrito" button using the matched variation's ID, and a secondary "Ver otros tamaños" link to the product page. When no specific variation matches, the card shows a single "Elegir tamaño" button. Simple products and single-variation products show a standard "Agregar al carrito" button.
Multi-tenancy boundary uses `instance_id`, consistent with all other Scout tables.
3. Meilisearch Cloud setup
Project configuration

* Project name: `scout-production`
* Region: closest to merchant traffic; default `us-east` for now
* Plan: Build ($30/month) at launch
* Master API key: stored in Scout backend env var `MEILISEARCH_MASTER_KEY`
* Project URL: stored in `MEILISEARCH_HOST`
* Analytics and monitoring: enabled (free at all tiers)
Index naming convention
`inst_<instance_id>` where `instance_id` is the integer primary key from Scout's `instance` table (note: singular table name, consistent with all other Scout tables — see CLAUDE.md §2). The template instance has `instance_id = 0`; that's a valid value, not a falsy sentinel — never use `if (!instanceId)` checks.
Index settings defaults (applied at creation)
The `searchableAttributes` MUST include `variants.attributes` and `variants.sku` to enable nested-field matching for variation queries. Spanish stop words and pet-domain synonyms are baked in as defaults; Stage 5 will let merchants override these per-instance. Typo tolerance enabled with `oneTypo` at 4 chars and `twoTypos` at 8 chars. Faceting max 100 values per facet. Pagination max 1000 hits.
Searchable attributes: `name`, `brand`, `categories`, `description`, `variants.attributes`, `variants.sku`, `scout_attributes.lifestage`, `scout_attributes.species`, `scout_attributes.breed_compatibility`, `scout_attributes.medical_conditions`.
Filterable attributes: `instance_id`, `category_ids`, `brand`, `in_stock`, `scout_attributes.species`, `scout_attributes.lifestage`, `price`.
Sortable attributes: `price`, `created_at`, `popularity`.
Ranking rules (in order): `words`, `typo`, `proximity`, `attribute`, `sort`, `exactness`, `popularity:desc`.
Stop words (Spanish): `el`, `la`, `los`, `las`, `un`, `una`, `de`, `del`, `para`, `con`, `y`, `o`.
Synonyms (pet-domain Spanish): `comida` ↔ `alimento` ↔ `kibble`, `perro` ↔ `can`, `gato` ↔ `felino`.
4. Document schema
The schema for documents indexed in Meilisearch.
Identity fields: `id` (Scout's internal product ID), `instance_id` (defense-in-depth filter), `woocommerce_id` (WC post ID).
Display fields from WooCommerce: `name`, `slug`, `description` (HTML stripped), `short_description`, `url` (computed), `image_url`, `thumbnail_url`.
Categorization from WooCommerce: `categories` (names), `category_ids` (WC term IDs), `tags`, `brand`.
Scout enrichment under `scout_attributes`: `species[]`, `lifestage[]`, `breed_compatibility[]`, `size`, `weight_grams`, `food_type`, `medical_conditions[]`, `age_min_months`, `age_max_months`.
Variation summary under `variation_summary`: `type` (`'simple'` | `'variable_single'` | `'variable_multi'`), `purchasable_variation_count`, `default_variation_id`, `default_variation_sku`, `price_range` (`{min, max}`), `in_stock_summary` (`{any_in_stock, all_in_stock}`).
Variants array — each entry contains: `variation_id`, `sku`, `attributes` (Record<string, string>), `price`, `sale_price`, `in_stock`, `stock_quantity`, `image_url`.

**Attribute key convention.** Keys in `variants[].attributes` MUST be the WC taxonomy slug (e.g. `pa_size`), NOT the human-readable name (`Tamaño`). Slugs are stable identifiers — names get localized and renamed. The WordPress plugin uses these keys to build add-to-cart URLs of the form `?attribute_pa_size=4kg`, which only works with slug keys.
Top-level commerce mirrors: `price` (for variable products equals `price_range.min`), `sale_price`, `currency`, `in_stock`, `sku`.
Other: `popularity` (default 0, populated in Stage 4), `created_at`, `updated_at`, `indexed_at`, `_schema_version: 1`.
Field source rules

* WooCommerce-sourced fields: WooCommerce REST API is source of truth. Scout reads, never writes back.
* Scout-enriched fields (`scout_attributes.*`): Scout is the only source.
* Computed fields (`url`, `popularity`, `variation_summary`): Computed at indexing time.
* HTML stripping: `description` and `short_description` must have HTML tags stripped.
variation_summary computation rules

* `type: 'simple'`: WooCommerce product type is `simple`.
* `type: 'variable_single'`: Type is `variable` AND exactly one variation is published, in_stock, and visible.
* `type: 'variable_multi'`: Type is `variable` AND two or more variations are purchasable.
* `default_variation_id`: For `simple`, the parent product ID. For `variable_single`, the one purchasable variation. For `variable_multi`, the variation marked default in WooCommerce, falling back to the first in-stock variation if no default is set, falling back to null if nothing is in stock.
5. Scout backend — `meilisearch_client` module
Stage: 0.
Module location: `src/lib/search/meilisearch-client.ts`. This is the only place in Scout's codebase that holds the Meilisearch master key.
Required interface includes index lifecycle (`createIndex`, `deleteIndex`, `indexExists`), settings management (`applyDefaultSettings`, `updateSettings`, `getSettings`), document operations (`upsertDocuments`, `deleteDocument`, `deleteAllDocuments`, `getDocumentCount`), search (with `showMatchesPosition: true` requested — verify exact option name in current SDK), token generation, and health (`ping`, `getTaskStatus`).
Implementation requirements: use the official `meilisearch` npm package (latest stable); never log the master key; wrap Meilisearch errors with Scout-specific context; all write operations return `TaskInfo` for tracking; search operations request match positions for the variant selection logic.
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
6. Scout backend — token-issuing API endpoint
Stage: 0.
Endpoint: `POST /api/v1/search/token`
Request body: `{ instance_id: number }`. Origin header required.
Success response: `{ token, expires_at, meilisearch_host, index_uid }` with `Cache-Control: no-store`.
Error response (instance unknown OR origin not registered): 403 with generic message `instance_not_found_or_origin_not_authorized`. Error responses MUST NOT distinguish between the two cases (prevents enumeration).
Validation: `instance_id` parses as a non-negative integer (note: 0 is valid — the template instance); instance must exist and be `active` in the `instance` table; origin must be in `instance.storefront_domains`; rate limit 60/min per (instance_id, origin), 600/min per IP, both → 429; CORS echoes Origin if validated, never `*`.
Trust model: instance_id is public (like a Stripe publishable key). Origin validation is the security boundary. Rate limiting prevents abuse. No auth header from the WordPress plugin in Stage 1. Future hardening (Stage 4+) adds HMAC signature with per-instance secret.
7. Scout backend — search proxy endpoint
Stage: 1. The WordPress plugin calls this endpoint, so it lands in the same stage as the plugin.
Endpoint: `POST /api/v1/search`. The middle-layer endpoint the WordPress plugin calls. Proxies to Meilisearch with server-side tenant token management and adds the variant selection logic.
Request: `{ instance_id, query, limit, offset, filters, sort }`. Response: `{ hits[], total_hits, processing_time_ms, query_uid }` where each hit is `{ document, matched_variation, _score }`.

**`matched_variation` shape.** When non-null, `matched_variation` is a **full variant object** matching the exact shape of entries in `document.variants[]`: `variation_id`, `sku`, `attributes` (Record<string,string> with slug keys per §4), `price`, `sale_price`, `in_stock`, `stock_quantity`, `image_url`. Not just a `variation_id` reference — the whole object, so the plugin can render a card without a second lookup. `null` for `simple` products and for `variable_multi` products with no in-stock variation found.
Variant selection logic
For each Meilisearch hit, compute `matched_variation`:

* If `document.variation_summary.type == 'simple'`: `matched_variation = null` (card uses document's top-level fields).
* If `'variable_single'`: `matched_variation` = the one purchasable variation.
* If `'variable_multi'`: read Meilisearch's `_matchesPosition`. Count matches per variant index in the `variants` array. Pick the in-stock variant with the most matches. If no variant had specific matches, fall back to `default_variation_id` (if in stock), then to first in-stock variant, then to null.
This logic is roughly 15-25 lines of pure, unit-testable TypeScript.
Validation: validate `instance_id` and `Origin` exactly as token endpoint. Acquire tenant token internally (cached for TTL minus 1 minute). Forward search to Meilisearch with `showMatchesPosition: true`. Process with variant selection. Log query, total_hits, processing_time, variant selection result to `query_log` table.
8. Scout admin — instance search settings
Stage 0 ships connection panel + storefront-domains editor + Instance-ID copy. Stage 1 adds indexing status + reindex.
Page lives at `/configuration/search`, matching the existing pattern at `src/app/[locale]/(app)/configuration/<integration>/page.tsx` (see `/configuration/algolia` and `/configuration/woocommerce`). The current instance is resolved from the JWT via `currentInstanceId()`, not from the URL.
Stage 0 deliverables: connection status panel (green/red), storefront domain registration field (stored in `instance.storefront_domains` text array), plugin instructions with copy-button for Instance ID.
Stage 1 deliverables: indexing status panel (last sync, document counts, mismatch detection), manual reindex button with confirmation modal, WooCommerce credentials form (REST API URL, consumer_key, consumer_secret).
No search behavior configuration in Stage 1 — that's Stage 5.
9. Stage 1 — Indexing pipeline
Cron-based polling, every 5 minutes per active instance (Vercel cron or similar).
Flow: fetch incremental WooCommerce changes (`modified_after` query param); for each changed parent product, fetch variations, run minimal Stage 1 enrichment, compute `variation_summary`, build document with `variants` array; upsert batch to Meilisearch; update `instance.last_search_sync_at`; log stats.
Initial full sync paginates through all products. Per-page 100, until empty.
Failure modes: WooCommerce unreachable → log, retry next tick. Meilisearch upsert fails → log task UID, retry. Single product enrichment fails → log, skip, continue batch. Schema validation fails → log, skip, add to `failed_indexing` table.
Stage 1 enrichment scope is intentionally minimal — NOT the 7-agent pipeline. It strips HTML, maps WC categories to `species` via hardcoded lookup, detects lifestage from product name keywords (`puppy`, `senior`, `cachorro`, `adulto`), sets `popularity: 0`, computes `variation_summary`, populates `variants` array.
Variation handling specifics: include all variations including out-of-stock (the `in_stock` flag distinguishes); exclude hidden and draft variations entirely; respect WooCommerce's stock_quantity vs stock_status semantics.
10. Stage 1 — WordPress plugin v0.1
Distribution: `.zip` file from Scout's CDN. Not initially submitted to WordPress.org plugin directory. Auto-update mechanism out of scope for v0.1.
Plugin structure: `scout-search.php` (main file), `readme.txt`, `includes/` (settings, search, api, card classes), `admin/settings-page.php`, `assets/css/scout-card.css`.
Settings page (WordPress admin → Settings → Scout Search): single text input for Scout Instance ID, Test connection button calling Scout's `/api/v1/search/token`, Status display. On save: POST to Scout API, 200 → "Conectado", 403/404 → invalid ID/domain message, network error → connectivity message.
Search query interception via `pre_get_posts` when `is_search()` and product post type. Capture search term, call Scout's `/api/v1/search`, cache `matched_variation` map keyed by product ID in transient, override WP_Query with `post__in` and `orderby=post__in`. WordPress renders results via merchant's existing theme.
Search result card rendering: plugin overrides WooCommerce card on search results pages only (not category or other listings) via WooCommerce template hooks. Look up `matched_variation` from transient. For simple/variable_single: single "Agregar al carrito" button or "Agotado" badge. For variable_multi with matched variation in stock: two buttons stacked vertically on mobile — primary "Agregar [variant attributes] al carrito" with matched variation ID, displaying matched variation's price (not parent's range) and image (if different from parent); secondary "Ver otros tamaños" linking to product page. For variable_multi with no specific match but stock available: single "Elegir tamaño" linking to product page. All out of stock: "Agotado" badge.
Spanish wording (Latin American / Guatemalan): "Agregar al carrito", "Agregar [size] al carrito", "Ver otros tamaños", "Elegir tamaño", "Agotado", "Conectado", "ID de instancia inválido".
Failure mode: Scout API unreachable → fall back to WordPress's default search. Log to a WP option for diagnostic visibility. Never break the merchant's storefront.
Plugin settings storage: `scout_search_instance_id`, `scout_search_meilisearch_host`, `scout_search_index_uid`, `scout_search_last_token_check`, `scout_search_status`. Tokens in WP transients (14-min TTL). Search-results metadata in transients per request.
11. Test cases
Indexing pipeline tests: full sync completes with document count within 1% of WC product count; modified products propagate within 6 minutes; deletions propagate within 6 minutes; HTML stripped from descriptions; stock changes propagate; variable products index with full variants array; variation_summary type computed correctly for simple/variable_single/variable_multi cases.
Search behavior tests on Wazú: 20 representative Spanish queries with expected behaviors covering keyword search, synonym handling, typo tolerance, brand+species filtering, variation-specific matches (e.g., "royal canin renal 4kg" → 4kg variation matched), broad queries, zero-result queries, empty query, stop word filtering, emoji input safety, XSS sanitization, lifestage detection.
Variant matching tests: query matching specific variant attribute → correct `matched_variation`; query matching only parent → falls back to default_variation_id; matched variant out of stock → falls back to next in-stock variant; simple product → matched_variation is null.
Card rendering tests: simple+stock → "Agregar al carrito"; variable_single+stock → "Agregar al carrito" with variation ID; variable_multi+matched+stock → two-button layout; variable_multi+no match+any stock → "Elegir tamaño"; out of stock → "Agotado" badge; mobile (<768px) → two-button stacks vertically.
Token endpoint tests: valid request → 200; invalid ID → 403 generic; valid ID wrong origin → 403 generic; rate limit → 429; token authorizes search; token expires correctly.
Plugin tests: install + valid ID → "Conectado" within 10 seconds; invalid ID → clear error; search returns Scout-ranked results; deactivation reverts to WC default; uninstall removes all options cleanly; add-to-cart on matched-variation card adds correct variation ID.
12. APPROVAL REQUIRED — Checkpoint 1
Before writing any code, Claude Code must:

1. Confirm understanding of all decisions in this document.
2. Identify any ambiguities or contradictions and ask clarifying questions.
3. Propose the file tree for both the Scout backend changes and the WordPress plugin, listing every file that will be created or modified.
4. Wait for explicit approval of the file tree before writing any code.
13. APPROVAL REQUIRED — Checkpoint 2
After the file tree is approved and Claude Code has written the code:

1. Run all tests in section 11.
2. Report which tests pass and which fail, with reasons for any failures.
3. Wait for explicit approval before merging to main.
4. Open a PR; do not auto-merge. Tuncho reviews before merging.
14. Out of scope (later policy docs)

* Click and conversion event tracking → `search-events.md` (Stage 4)
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
End of policy document. Start with Checkpoint 1 (section 12) before writing any code.
