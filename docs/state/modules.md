---
application: core-app
module: State
title: "GroLabs — Modules (current state)"
status: Draft
audience: "Contributors and assistants who need to know what is actually built on disk right now and how code clusters map to the Module Map."
scope: "Point-in-time inventory (2026-05-17, commit 2f200e2) of code clusters, routes, server actions, and gaps, derived from src/ and supabase/migrations/. Time-sensitive; the repo is authoritative (Constitution Article 10)."
actors:
  - name: Identity / tenancy
    type: system
    definition: "Tenant/instance layer (M1/M2): tenant + tenant_member migrations, instance.ts/instanceSlug.ts, instance actions, Supabase server/client/service-role clients."
  - name: Catalog
    type: system
    definition: "M3/M4: product/variant/category/attribute actions and routes, plus brand_manufacturer and attribute-screen migrations."
  - name: Pricing
    type: system
    definition: "M5/M6: GroLabs-native pricing (calculate/charm/compute/column-detect/parse-money) + routes for changes/policies/providers/sync/violations. Built in this repo, not as a WP plugin."
  - name: Sync
    type: system
    definition: "M7/M8: GroLabs→WC + Algolia push (woocommerce-client, algolia-client, mappings, sync-status) and the WC→GroLabs pull import path (xlsx, automap, vocabulary)."
  - name: Search Engine
    type: system
    definition: "M9/M11: Meilisearch client/indexer/document-builder + api/v1/search(/token) routes + storefront-domains and rate-limit migrations. M10 Search Experience is the separate WP plugin, not in this repo."
  - name: Analytics
    type: system
    definition: "M12/M13: GA4 integration routes (auth/callback/poll/realtime), dashboard/traffic, and the Algolia search no-results + synonym dashboard. M18 GA4 Plugin is a separate WP plugin."
  - name: Funnel
    type: system
    definition: "Conceptual analysis/scenario tool: computeModel/edgeRouting/highlightRules/queries/revenue/validation + funnel routes and schema/seed/template migrations."
  - name: Optimization Agent
    type: system
    definition: "M14/M15: not yet a standalone module on disk. Only agent-adjacent helpers exist (import/agent-message.ts); the attribute-extraction contract is specced (Constitution Article 12, search-foundations) but unbuilt."
integrations:
  - name: WooCommerce
    kind: external-service
    target: "merchant store (REST)"
    direction: both
    purpose: "Sync pushes GroLabs→WC; WC Import pulls WC→GroLabs via the import wizard."
  - name: Meilisearch
    kind: external-service
    target: "search index"
    direction: both
    purpose: "Primary search engine (src/lib/search/*) behind api/v1/search."
  - name: Algolia
    kind: external-service
    target: "search index + no-results analytics"
    direction: both
    purpose: "Coexists with Meilisearch (sync/algolia-* + dashboard no-results/synonyms); transition plan still unstated."
  - name: GA4
    kind: external-service
    target: "Google Analytics property"
    direction: both
    purpose: "Traffic analytics via the ga4 integration routes and dashboard/traffic."
rules:
  - id: R-1
    statement: "There are no Supabase edge functions (supabase/functions/ is absent); all server logic is Next.js server actions + route handlers + SQL RPCs in migrations."
    truth: true
    rationale: "Note under the regenerated header."
  - id: R-2
    statement: "Pricing is built GroLabs-native in this repo (src/lib/pricing/* + Supabase migrations), consistent with Constitution Article 9 and contradicting the superseded docs/design/pricing/* WP-plugin framing."
    truth: true
    rationale: "'Notable gaps / observations'."
  - id: R-3
    statement: "Algolia and Meilisearch coexist in the codebase; the transition plan from one to the other is still unstated (cross-doc inconsistency, Review 1 Appendix B)."
    truth: true
    rationale: "'Notable gaps / observations'."
  - id: R-4
    statement: "The Optimization Agent has no standalone module yet; Constitution Article 12 + search-foundations define the contract for when it is built."
    truth: true
    rationale: "'Notable gaps / observations' and the Optimization Agent code-cluster row."
useCases:
  - id: T-1
    title: "Confirm pricing is native, not a plugin"
    given: "A reader recalls the docs/design/pricing/* WP-plugin framing"
    when: "They check this snapshot's pricing cluster and observations"
    then: "They find pricing implemented in-repo (src/lib/pricing/* + migrations), confirming the WP-plugin docs are superseded"
    verifies: [R-2]
---

# GroLabs — Modules (current state)

**Regenerated:** 2026-05-17
**Source commit:** `2f200e2` (HEAD of branch `claude/strange-gates-28d046`)
**Method:** inspection of `src/` and `supabase/migrations/`; cross-referenced to `docs/module-map.md`. Repo is source of truth (Constitution Article 10).

> Supersedes the 2026-04-30 @ `b43157a` snapshot.
> Note: there are **no Supabase edge functions** (`supabase/functions/` is absent); all server logic is Next.js server actions + route handlers + SQL RPCs in migrations.

---

## Code clusters → Module Map mapping

| Code cluster | Files | Module Map module |
|---|---|---|
| Identity / tenancy | migrations `20260513000001_add_tenant_layer`, `20260514000001_add_tenant_member`, `20260510000010_instance_member_is_current`; `src/lib/instance.ts`, `src/lib/instanceSlug.ts`, `src/lib/actions/instance.ts`, `src/lib/supabase/{server,client,service-role}.ts` | M1 Identity / M2 Identity Admin UI |
| Catalog | `src/lib/actions/{product,variant,category,categoryAttribute}.ts`; routes `catalog/{products,categories,attributes}`; migrations `initial_schema`, `attribute_screen_schema`, `product_attribute_*`, `brand_manufacturer` | M3 Catalog / M4 Catalog Admin UI |
| Pricing | `src/lib/pricing/{calculate,charm,compute,column-detect,parse-money}.ts`, `src/lib/actions/pricing.ts`; routes `pricing/{changes,policies,providers,sync,violations}`; migrations `pricing_module_schema`, `price_list_item_suggested_price`, `provider_fields`, `pricing_config_and_charm_rule`, `price_batch_syncing_state`, `charm_rule_ends_in_whole` | M5 Pricing / M6 Pricing Admin UI |
| Sync (GroLabs→WC + Algolia) | `src/lib/sync/{woocommerce-client,woocommerce-categories,woocommerce-mapping,algolia-client,algolia-mapping,sync-status}.ts`, `src/lib/actions/sync.ts`; route `sync/`; migrations `sync_status_and_log`, `woocommerce_config_helpers`, `category_sync_status` | M7 Sync / M8 Sync Admin UI |
| WC Import (WC→GroLabs, pull) | `src/lib/import/{xlsx,step4-automap,vocabulary,types,attribute-colors,highlight-source,agent-message}.ts`, `src/lib/actions/import.ts`; routes `import/{text,wizard,woocommerce}`; migrations `import_job`, `import_staging`, `catalog_suggestion`, `wc_import_columns` | M7 Sync (pull path) / M4 Catalog Admin UI |
| Search Engine (Meilisearch) | `src/lib/search/{meilisearch-client,document-builder,indexer,variant-matcher,trigger,rate-limit,types}.ts`; routes `api/v1/search`, `api/v1/search/token`, `configuration/search`; migrations `meilisearch_sync_status_and_log`, `instance_storefront_domains`, `search_rate_limit` | M9 Search Engine / M11 Search Admin UI (M10 Search Experience = the separate WP plugin, not in this repo) |
| Analytics — GA4 | routes `api/v1/integrations/ga4/{auth,callback,poll,realtime}`, `dashboard/traffic`, `configuration/ga4`; migrations `ga4_daily_tables`, `ga4_alert`, `ga4_config_helpers` | M12 Analytics / M13 Analytics Admin UI (M18 GA4 Plugin = separate WP plugin) |
| Analytics — search no-results | route `dashboard/` + `dashboard/actions.ts` (Algolia no-results + synonym creation) | M12 Analytics / M13 Analytics Admin UI |
| Funnel | `src/lib/funnel/{computeModel,edgeRouting,highlightRules,queries,revenue,stageIcons,types,validation}.ts`, `src/lib/actions/funnel.ts`; routes `funnel/`, `funnel/[funnelInstanceSlug]`; migrations `funnel_schema`, `funnel_rls`, `funnel_seed`, `funnel_short_electronics_template` | (Funnel — conceptual analysis/scenario tool; see `docs/funnel/spec.md`) |
| Shell / i18n / styleguide | `src/components/shell/*`, `src/i18n/*`, `src/middleware.ts`, route `styleguide/` | M16 GroLabs Admin (chassis) |
| Optimization Agent | **No dedicated agent module on disk yet.** Agent-adjacent helpers exist (`src/lib/import/agent-message.ts`); attribute-extraction capability is specced (search-foundations §"Attribute extraction", Constitution Article 12) but not yet a standalone module. | M14 Optimization Agent / M15 Agent Admin UI (designed, not built) |

## Routes present (`src/app/[locale]/(app)/`)

`catalog/{page, products, products/[id], products/new, categories, attributes}` · `pricing/{page, changes, changes/[batch_id], policies, providers, providers/new, providers/[id], sync, violations}` · `dashboard/{page, traffic}` · `import/{page, text, wizard, woocommerce}` · `configuration/{algolia, ga4, search, woocommerce}` · `sync/` · `funnel/{page, [funnelInstanceSlug]}` · `styleguide/` · `login/` (outside `(app)`).

API route handlers (`src/app/api/v1/`): `search`, `search/token`, `integrations/ga4/{auth,callback,poll,realtime}`.

## Server-action surface (`src/lib/actions/`)

`category.ts`, `categoryAttribute.ts`, `funnel.ts`, `import.ts`, `instance.ts`, `pricing.ts`, `product.ts`, `sync.ts`, `variant.ts`. (Some routes also carry co-located `actions.ts`: attributes, algolia, ga4, search, woocommerce, dashboard, dashboard/traffic, import/woocommerce.)

## Notable gaps / observations

- **Pricing is built GroLabs-native in this repo** (`src/lib/pricing/*` + Supabase migrations) — consistent with Constitution Article 9 and contradicting the superseded `docs/design/pricing/*` WP-plugin framing.
- **Algolia and Meilisearch coexist**: `src/lib/sync/algolia-*` + `dashboard` no-results (Algolia) alongside `src/lib/search/*` (Meilisearch). Transition plan still unstated (cross-doc inconsistency, Review 1 Appendix B).
- **Optimization Agent** has no standalone module; Constitution Article 12 + search-foundations now define the contract for when it is built.
