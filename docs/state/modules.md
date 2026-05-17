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
