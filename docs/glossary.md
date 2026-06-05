---
title: "GroLabs — Glossary"
status: Draft
---

# GroLabs — Glossary

Key terms across the GroLabs system. Definitions are derived from the specs in
this corpus (notably `state/schema.md`, `state/modules.md`, and the policy
specs). Terms cross-reference one another with `[[double brackets]]`, which the
Designer resolves to links; a `[[term]]` mention in any dossier also links back
here.

## Algolia

A search index that currently coexists with [[Meilisearch]] in the codebase
(`src/lib/sync/algolia-*` plus the dashboard no-results / synonym tooling). The
transition plan from Algolia to Meilisearch is still unstated.

See also: Meilisearch, Search Engine

## Attribute

A named property of a [[Product]] — e.g. colour, weight, volume. Defined exactly
once as a `product_attribute` row and linked from a [[Category]] via
`category_product_attribute`; categories never redefine it. A quantity attribute
stores a number plus a unit rather than splitting into per-unit attributes.

See also: Product, Category, Variant axis

## Catalog

The system of record for product structure inside GroLabs — products, variants,
categories, and attributes. GroLabs owns the canonical UUID of every entity;
external storefront IDs are mapped references. The Catalog hands structured
results to [[Sync]] and to the [[Search Engine]].

See also: Product, Sync, Search Engine

## Category

A grouping of products. Categories link to [[Attribute|attributes]] through
`category_product_attribute`; the [[Variant axis|variant axes]] for a product are
read from that link (the `is_variant_axis` flag), not from a column on the
category.

See also: Attribute, Variant axis, Product

## Charm rule

A pricing rule that rounds a computed price to a psychologically "charming"
ending (e.g. .99). Stored per [[Instance]] as `charm_rule` (with an
`ends_in_whole` option). Part of the GroLabs-native [[Pricing]] engine.

See also: Pricing, Price list

## Funnel

The conversion-funnel analysis and scenario-modelling tool. Shared definition
tables (`funnel_flow`, `funnel_stage`, `funnel_transition`,
`funnel_friction_point`) describe a flow; a [[Funnel instance]] binds it to one
[[Instance]] with its own datasets.

See also: Funnel instance, Friction point

## Funnel instance

A per-[[Instance]] binding of a shared funnel flow (`funnel_instance`), owning
its datasets, benchmark sources, and friction findings. Several per-instance
funnel tables derive their `instance_id` by trigger from this parent.

See also: Funnel, Instance

## Friction point

A shared, named point of conversion loss in a funnel flow
(`funnel_friction_point`). Observed occurrences are recorded per instance as
`funnel_friction_finding`.

See also: Funnel

## GA4

Google Analytics 4. Traffic analytics are pulled into instance-scoped daily
rollup tables (`ga4_session_daily`, `ga4_traffic_daily`, …) plus `ga4_alert`.
The OAuth refresh token lives in [[Supabase Vault]]; config sits on
`instance.integrations_config.ga4`.

Aliases: Google Analytics 4

See also: Instance, Supabase Vault

## Import job

A WooCommerce-to-GroLabs catalog pull (`import_job`), with raw rows staged in
`import_staging` and proposed catalog changes in `catalog_suggestion`. Import is
one-way (WC → GroLabs) in v1.

See also: WooCommerce, Catalog

## Instance

The tenancy boundary. Every catalog, pricing, analytics, and funnel row is
scoped to one instance by its `instance_id` column and isolated from other
instances by [[Row-Level Security]]. The `instance` table was renamed from the
original `tenant` table; `instance_id` (not `tenant_id`) is the boundary column
everywhere.

Aliases: instance_id

See also: Tenant, Row-Level Security, Template

## Map rule

A pricing rule that maps a [[Provider|provider's]] source columns/values into
GroLabs price-list items (`map_rule`). Part of the native [[Pricing]] engine.

See also: Provider, Pricing

## Meilisearch

The primary search engine. The [[Catalog]] pushes documents to a per-instance
index named `inst_<instance_id>` on change; the storefront queries it through the
search API. Index config lives in Meilisearch, not Postgres — only `query_log`
and `search_rate_limit` are Postgres-side.

Aliases: Meili

See also: Search Engine, Catalog, Algolia

## Optimization Agent

The capability that proposes missing [[Attribute|attribute]] values. It proposes
only — it never writes catalog data without explicit approval. No standalone
module exists on disk yet; the contract is specced in the constitution and
search-foundations.

Aliases: agent

See also: Attribute, Catalog

## Price batch

A batched set of price changes (`price_batch` + `price_batch_item`) with its own
syncing state, applied to a [[Price list]] and pushed out via [[Sync]].

See also: Price list, Pricing, Sync

## Price list

A set of priced items for an [[Instance]] (`price_list` + `price_list_item`, the
latter carrying a `suggested_price`). The core output of the [[Pricing]] engine.

See also: Pricing, Price batch, Provider

## Pricing

The GroLabs-native pricing engine (`src/lib/pricing/*` plus Supabase
migrations): providers, price lists, map rules, charm rules, and price batches.
Built in this repo, contradicting the superseded WP-plugin framing in
`docs/design/pricing/*`.

See also: Provider, Price list, Charm rule, Map rule

## Product

The core [[Catalog]] entity (`product`). GroLabs owns its canonical UUID; the
external [[WooCommerce]] ID is stored as a mapped reference (`woocommerce_id` /
`wc_raw`), never inferred from name or SKU. A product has translations, media,
pricing, and one or more variants.

See also: Catalog, Product variant, WooCommerce

## Product variant

A purchasable variation of a [[Product]] (`product_variant`), selecting one
option per [[Variant axis]] via `product_variant_attribute`. Carries its own
`woocommerce_id`.

Aliases: Variant

See also: Product, Variant axis, Attribute

## Provider

A supplier whose source data feeds [[Pricing]] (`provider`, `provider_brand`).
[[Map rule|Map rules]] translate a provider's columns into price-list items.

See also: Pricing, Map rule, Price list

## Row-Level Security

Postgres policies that confine every query to the caller's [[Instance]]. The
tenancy isolation boundary across the whole core app: `instance_isolation_*` for
catalog/legacy tables, `tenant_read`/`tenant_write_all` for per-instance funnel
tables. Every table has RLS enabled except `scout_schema_version`.

Aliases: RLS

See also: Instance, Template, Tenant

## Search Engine

The module behind `api/v1/search`: a [[Meilisearch]] client, document builder,
and indexer plus storefront-domain and rate-limit support. The user-facing
search experience itself is a separate WordPress plugin, not in the core repo.

See also: Meilisearch, Catalog

## Sync

The integration that pushes the structured [[Catalog]] to [[WooCommerce]] (and
search indexes) and pulls raw store data back. Status is tracked in
`product_sync_status` / `category_sync_status` / `sync_log`. On a price conflict,
GroLabs wins.

See also: Catalog, WooCommerce, Import job

## Supabase Vault

Where credential secrets (e.g. the [[GA4]] OAuth refresh token) are stored.
Configuration references the secret via `instance.integrations_config`; the
secret value itself is never a column.

See also: GA4, Instance

## Single sign-on (SSO)

Sign-in to the GroLabs app/admin via an external identity provider — **Google**
(`provider: 'google'`) and **Microsoft** (`provider: 'azure'`, covering Microsoft
365 / Exchange-hosted domains) — through Supabase `signInWithOAuth`. Specced in
`docs/policy/user-management.md`: **sign-in only, never provisioning** — a sign-in
whose email has no already-provisioned account is rejected. Buttons are styled in
GroLabs `--gl-*` tokens with monochrome provider glyphs, **not** vendor brand
colors. Distinct from the merchant-site social-login plugin ([[Module 17]] /
Login Experience), which is a separate WordPress codebase.

See also: Tenant, Instance

## Template

An instance with `instance_id = 0`: shared template/vertical data visible only
via `service_role` (or, for funnel per-instance tables, through the
`instance_id = 0` read fallthrough). Industry-agnostic per the constitution.

See also: Instance, Row-Level Security

## Tenant

The account layer above [[Instance]] (`tenant` + `tenant_member`), added on
2026-05-13/14 with `kind` in (`template_owner`, `customer`). A trigger requires
an active `tenant_member` before any `instance_member` insert. Distinct from the
original `tenant` table, which was renamed to `instance`. A tenant's **identity
is its `domain`** (Constitution Article 3) — `tenant.domain` (unique, lowercased)
is added by `docs/policy/user-management.md`; the same domain joins the existing
tenant rather than duplicating it, and email is unique per user (the collaborator
model), not per tenant.

See also: Instance, Row-Level Security, Single sign-on (SSO)

## Variant axis

An [[Attribute]] marked as a variation dimension for a [[Category]] (the
`is_variant_axis` flag on `category_product_attribute`). A [[Product variant]]
selects exactly one option per axis.

See also: Attribute, Category, Product variant

## WooCommerce

The merchant's WordPress storefront platform and the system of record for
display and orders. GroLabs imports from it via [[Import job|import]] and
publishes back to it via [[Sync]]. Products carry its `woocommerce_id`.

Aliases: Woo, WC

See also: Sync, Import job, Product
