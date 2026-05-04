# Scout — Modules (current state)

Generated 2026-04-30. One section per functional module. Reflects what's
in `main` (HEAD = `b43157a`).

---

## Authentication (`/login`)

**State:** functional — email + password sign-in.

**Routes:**
- `/login` — public route at
  [`src/app/[locale]/login/page.tsx`](src/app/[locale]/login/page.tsx)
  (outside the `(app)` protected group). Centred-card layout via
  `s-auth-shell`; no sidebar/topbar chrome. Already-authenticated users
  hit `redirect("/dashboard")` on render. Surface error via the
  `?error=…` query param.

**Server actions:** inline `'use server'` action in the same file:
- `login(formData)` — reads `email` + `password` from FormData, calls
  `supabase.auth.signInWithPassword`, redirects to `/login?error=…` on
  failure or `/dashboard` on success. Errors are not echoed verbatim
  (the page renders a generic Spanish message); the raw Supabase error
  is in the URL only.

**Tables involved:** `auth.users` (Supabase-managed), `instance_member`
(read in `(app)/layout.tsx` after auth to resolve the active instance
and surface its name in the sidebar).

**Known gaps:**
- Email + password only. No SSO/Google login, no magic link, no
  passwordless flow (D17 noted this).
- No public sign-up flow — users are provisioned out-of-band
  (`auth.users` row + `instance_member` row created directly via the
  Supabase admin API).
- No password reset UI; resets happen via the admin API.

**Last touched:** PR #1 (initial scaffold); login itself unchanged
since.

---

## Dashboard (`/dashboard`)

**State:** read-only analytics + synonym-creation server action.

**Routes:**
- `/dashboard` — Algolia "no-results" analytics; surfaces top zero-result
  searches over a configurable window (24h / 7d / 30d) and a
  "create synonym" dialog.

**Server actions**
([`src/app/[locale]/(app)/dashboard/actions.ts`](src/app/[locale]/(app)/dashboard/actions.ts)):
- `addSynonym(query, synonym)` →
  `SynonymResult { ok, objectId?, taskId?, error? }`. **Server action
  (not an inline route handler).** Resolves the user's instance via
  `instance_member`, reads `instance.integrations_config.algolia` for
  `app_id` + `primary_index`, fetches the admin key from Vault via the
  `algolia_get_admin_key` RPC, then PUTs a new synonym to
  `https://<app_id>.algolia.net/1/indexes/<primary_index>/synonyms/<objectID>?forwardToReplicas=true`
  with a generated `scout_<timestamp>_<uuid8>` objectID and `type:
  "synonym"`, `synonyms: [query, synonym]`. Surfaces the Algolia task ID
  on success and the API error message on failure.

**Tables involved:** `instance_member` (read to resolve user's instance),
`instance.integrations_config` (read for Algolia config).

**Known gaps:**
- The synonym dialog is wired but the analytics subdomain mapping has a
  TODO at [page.tsx:16](src/app/[locale]/(app)/dashboard/page.tsx#L16) for
  the `in / sg / au / br / ca / za / uae / uk / jp / hk` regions — they
  all currently fall back to `analytics.us.algolia.com`.
- "Catalog alerts" panel is a placeholder (no data source yet).
- The Algolia request fires from the server with the admin key in plain
  HTTP — fine because it never crosses to the browser, but worth
  documenting for any future review of the request path.
- `addSynonym` reads the user's first active membership via
  `maybeSingle`; for a user who is a member of multiple instances it
  silently picks one. Not a problem today (Phase 1: one-membership-per-user)
  but worth flagging when multi-instance lands.

**Last touched:** PR #15 / #16 (Algolia analytics + synonym dialog).

---

## Catalog index (`/catalog`)

**State:** redirect-only — points to `/catalog/products`. No standalone UI.

---

## Catalog → Products

**State:** full CRUD on products + variants (Pass 4a). Dynamic axis
columns on the variant table are deferred to a follow-up.

**Routes:**
- `/catalog/products` — list with filter chips (all / active / inactive /
  consignment / service) and a "+ Nuevo producto" button at the
  top-right that opens a drawer.
- `/catalog/products/[id]` — product detail with inline-edit on every
  field (no edit-mode toggle).

**Server actions** (`src/lib/actions/product.ts` + `variant.ts`):
- `createProduct({ name })` → `{ ok, productId }` — creates a row with
  just the name; picks the first active `product_type` as default
  (save-anything UI promise: only `name` is required from the user).
- `updateProductField({ productId, field, value })` — single-field
  update with allowlist (9 fields: `product_name`, `slug`,
  `product_type_id`, `brand_id`, `short_description`,
  `long_description`, `is_consignment`, `track_inventory`, `is_active`).
- `deleteProduct({ productId })` — RLS-aware delete; FK cascade handles
  variants.
- `createVariant({ productId, axes?, variant_name?, variant_label?,
  sku?, barcode?, weight_grams?, is_active? })` — inserts a row +
  optional axis values into `product_variant_attribute`.
- `updateVariantField({ variantId, field, value })` — allowlist (10
  fields).
- `updateVariantAxisValue({ variantId, attributeId, value_id?,
  value_text?, value_number?, unit_id? })` — upsert against
  `(instance_id, variant_id, attribute_id)`. Handles categorical and
  quantity attributes.
- `deleteVariant({ variantId })`
- `upsertVariantPricing({ variantId, listPrice, costPrice?, channel?,
  currency?, minQuantity? })` — upsert against
  `(instance_id, variant_id, channel, min_quantity)`. Defaults retail
  / GTQ / 1.

All actions return `{ ok: true } | { error: string }` (or `{ ok, ...data }`
for actions that return generated IDs). All use `createClient` (RLS-aware)
and `currentInstanceId` with strict `=== null` guards.

**Tables involved:**
- Read: `product`, `product_translation`, `product_type`,
  `product_type_translation`, `brand`, `product_variant`,
  `product_variant_attribute`, `product_pricing`, `product_media`,
  `product_attribute_value`, `product_attribute`, `product_attribute_option`,
  `product_category_link`, `category`.
- Write: `product` (insert / update / delete), `product_variant` (insert
  / update / delete), `product_variant_attribute` (upsert),
  `product_pricing` (upsert).

**UI pattern** — inline edit:
- Click a field → swap to input. Blur or Enter → save (Cmd+Enter for
  textareas). Escape → cancel.
- Optimistic UI via React 19's `useOptimistic`. On error: auto-revert +
  sonner toast.
- Page-level "Guardado hace Xs" indicator near the title row, driven by
  `useSyncExternalStore` to keep render pure.
- Delete: inline confirm pattern (no modals). Trash2 icon → row swaps to
  Confirmar / Cancelar.
- New variant: draft row at the bottom with editable inputs;
  `createVariant` fires on first blur once any field has content;
  Escape clears the draft.
- New product: drawer (shadcn Sheet, right side) with a single name
  field. On Crear → `createProduct` + navigate to the detail page.

**Known gaps:**
- **Dynamic variant axis columns are not rendered yet.** Variant
  attribute axes (categorical text, quantity composites) are not yet
  wired into the variant table. The action surface
  (`updateVariantAxisValue`) exists; the UI columns + cell editors are
  the deferred "Pass 4b" follow-up.
- "Nueva categoría" / "Importar" buttons on the list page are still
  disabled (out of scope for this PR).
- No image upload — gallery is still a static "Sin imagen principal"
  placeholder. Image upload is its own future PR.
- Atributos del producto card on the detail page is read-only — there's
  no `updateProductAttributeValue` action yet.
- Per-species overrides (`category_species`) are not editable from the
  product detail (that lives on the categories detail page and is
  read-only there too).

**Last touched:** PR following up on PR #26 — this branch's commits.

### Catalog → Products — variants + manufacturer detail

This expanded section was the foundation for the products + variants
CRUD work. The current state (post-Pass 5) supersedes the read-only
descriptions in the original sub-sections; the live notes are in the
"State / Server actions / Known gaps" sections above.

#### Variants

**Variant axes resolution.** `src/lib/resolveVariantAxes.ts` walks a
category's ancestor chain root → leaf using a precomputed flat list of
categories and a list of `category_product_attribute` rows the caller
has already filtered to "this category and its ancestors." For each
ancestor level, attributes are deduplicated by `attribute_code` so that
the closest definition wins (leaf-closest override) — a child category
can replace an inherited axis simply by linking the same attribute code
on its own row. The function is pure: no Supabase calls inside; it
expects pre-fetched `VariantAxisRow[]` and the flat `CategoryNode[]` to
be passed in by the page. The returned set drives the variant table
headers and populates the agent context note shown on the categories
detail card. The single source of truth for "is this attribute a variant
axis on this category?" is the join row
(`category_product_attribute.is_variant_axis`), not a column on
`category`. The `category.default_variant_axes` column was dropped in
migration `20260426000003`.

**Variant table component.** Rendered inline inside
[`src/app/[locale]/(app)/catalog/products/[id]/page.tsx`](src/app/[locale]/(app)/catalog/products/[id]/page.tsx#L485-L599),
spanning the full width below the two-column layout. There is no
extracted component file for the variant table on `main` — it's a single
`<table className="s-table">` inside the product editor with seven
columns (Variante / SKU / Código de barras / Peso / Precio / Costo /
Estado). The "Nueva variante" button next to the table title is rendered
but `disabled`. PR #24 adds an extracted `VariantTable` component plus
per-variant CRUD; not yet merged.

**Existing field set per variant** (rendered on the product detail page,
fetched by the same `select` that loads the product):

| Column | Source | Display |
|---|---|---|
| Variante | `variant_name` (+ `variant_label` as sub-line when different) | text + sub-line |
| SKU | `sku` | monospace pill |
| Código de barras | `barcode` | monospace pill, "—" if null |
| Peso | `weight_grams` | `formatWeight(g)` → "500 g" / "3 kg" |
| Precio | `product_pricing.list_price` (channel = `retail`) | right-aligned, GTQ |
| Costo | `product_pricing.cost_price` (channel = `retail`) | right-aligned, GTQ, secondary text colour |
| Estado | `is_active` | dot + "Activa" / "Inactiva" |

Fields that exist on `product_variant` but are **not** rendered:
`upc`, `pack_unit`, `is_pack`, `inv_rotation_type`, `image_url`,
`wazudb1_id`. Variant attribute values (`product_variant_attribute`) are
not in the SELECT — variant axes are not displayed on the table at all.

There is no per-variant detail / edit screen (no
`/catalog/products/[id]/variants/[variantId]` route exists on `main`).
All variant data lives in the row of the inline table.

**What "read-only" means concretely** for the product detail page:

| Element | State |
|---|---|
| `name`, `short_desc`, `long_desc`, `slug`, `type` inputs | `disabled` with `defaultValue` |
| `brand`, `manufacturer`, `category` inputs | `disabled` with `defaultValue` |
| `is_active`, `track_inventory`, `is_consignment` toggles | rendered as `<div>` with `opacity: 0.6; cursor: not-allowed` |
| Atributos del producto card | renders as label/value `<div>` rows, not editable |
| Galería | static "Sin imagen principal" placeholder, "Subir nueva" button `disabled` |
| Volver button | works (locale-aware Link) |
| Guardar cambios button | `disabled title="Edición — próximamente"` |
| Nueva variante button | `disabled` |
| Variant rows | rendered as `<td>` text — no edit / delete affordance, no row click handler |

No `updateProduct`, `updateVariant`, `deleteVariant`, `setVariantPricing`,
`addVariantImage`, or any other product/variant mutation server action
exists on `main`. There is no `src/lib/actions/product.ts`,
`src/lib/actions/productVariant.ts`, or co-located `actions.ts` in the
products route folder.

#### Manufacturer field

**Resolved as of migration `20260430000005_brand_manufacturer.sql`** —
the `product.manufacturer` column was dropped and a nullable
`manufacturer text` column was added to `brand`. The product detail UI
no longer renders the field; the brand CRUD UI that exposes it for
editing is a future PR (brand-edit screen). Existing data was test/seed
only and was not migrated.

The original investigation that led to the migration (kept here for
reference): the column was a free-form text duplicated across every
product of a given brand with inevitable spelling drift. There was no
existing `product_attribute` row with `attribute_code = 'manufacturer'`,
and the `brand` table didn't have a manufacturer column or link, so the
move to `brand.manufacturer` was the cleanest normalisation.

---

## Catalog → Categories (`/catalog/categories`)

**State:** partial CRUD — read everywhere, write only on
`category_product_attribute` (variant axis configuration + attribute
linking) and on `category.parsing_note`.

**Routes:**
- `/catalog/categories` — split layout: species filter + 2-level tree on
  the left, accordion detail on the right. Selection driven by
  `?id=<category_id>` so it's deep-linkable.

**Server actions** (`src/lib/actions/category.ts`,
`src/lib/actions/categoryAttribute.ts`):
- `updateVariantConfig(categoryId, axes, parsingNote)` →
  `{ ok: true } | { error }` — clears all `is_variant_axis` flags on
  the category, sets new ones in order, updates `parsing_note`. Used by
  the variant axis editor card.
- `addCategoryAttributeLink(categoryId, attributeId)` →
  `{ ok: true } | { error }` — links an attribute to a category as a
  descriptive (non-axis) attribute.
- (Other helpers in `categoryAttribute.ts` for removing / overriding
  inherited attribute settings; read the file for the full list.)

**Tables involved:**
- Read: `category`, `category_translation`, `category_species`,
  `category_species_translation`, `species`, `species_translation`,
  `category_product_attribute`, `product_attribute`,
  `product_category_link`, `product`, `brand`, `product_variant`.
- Write: `category_product_attribute` (insert / update / delete),
  `category.parsing_note` only — no other category column is editable.

**Known gaps:**
- No category create / rename / delete — the tree is fixed once seeded.
- "Crear categoría" button is `disabled`.
- "Importar" button on the categories page is `disabled`.
- Per-species overrides (`category_species`) are read-only — the species
  filter pills just navigate; there's no edit form for the species
  visibility toggles, navigation_title, header_title, or visual_order
  shown in the detail accordion.

**Last touched:** PR #14 (variant axes via the join table). PR #17 is
still open — refactors the attributes-on-categories editor.

---

## Catalog → Attributes (`/catalog/attributes`)

**State:** full CRUD.

**Routes:**
- `/catalog/attributes?id=<n>&mode=create` — split layout: list on the
  left, editor on the right. Search + facet filters on the list.

**Server actions** (`src/app/[locale]/(app)/catalog/attributes/actions.ts`,
co-located with the route):
- `createAttribute(input)` → `{ ok, data: { attribute_id } } | { error }`
- `updateAttribute(attributeId, input)` → `{ ok } | { error }`
- `deleteAttribute(attributeId)` → `{ ok } | { error: "LINKED:N" | string }`
  — refuses delete when the attribute is linked to ≥1 category.
- `addAttributeOption(attributeId, input)` →
  `{ ok, data: { value_id } } | { error }`
- `updateAttributeOption(optionId, input)` → `{ ok } | { error }`
- `deleteAttributeOption(optionId)` → `{ ok } | { error }`
- `reorderAttributeOptions(attributeId, optionIds[])` → `{ ok } | { error }`

**Tables involved:** `product_attribute`, `product_attribute_option`,
`category_product_attribute` (read-only — used for the link-count guard
on delete).

**Known gaps:**
- Translations (`product_attribute_translation`,
  `product_attribute_option_translation`) are not editable from the UI —
  the admin only edits the base-locale rows. The translation tables exist
  but have no corresponding form.
- `dimension` and `suggested_unit` fields are editable, but the
  quantity-attribute UI doesn't validate that `data_type = 'quantity'`
  matches a non-null `dimension` — it's a soft contract.

**Last touched:** PR #17 (open) refactors the screen + adds an agent
panel.

---

## Catalog — Brands / Tipos de producto / Etiquetas / Reglas de coincidencia

**State:** not built. All four sidebar entries have `href: null`,
render as disabled "Próximamente" items.

The underlying tables exist (`brand`, `product_type`, `commercial_tag`,
`pet_product_matching_rule`) and are populated for the Wazu instance, but
no admin UI has been built.

---

## Datos → Import (`/import`)

**State:** scaffolded only. The recent-jobs list reads `import_job` rows,
but no import path is functional — text, Excel, and migration are all
placeholder cards. (The earlier draft of this file claimed the
text-paste path was active; verifying
[`/import/text/page.tsx`](src/app/[locale]/(app)/import/text/page.tsx)
shows the input + Parsear button are both `disabled` and the page
explicitly states "se habilitará cuando se complete CI-11".)

**Routes:**
- `/import` — landing with three method cards (text / Excel / migration).
  All three are disabled. Recent imports list reads `import_job` rows.
- `/import/text` — placeholder form: a `disabled` text input + a
  `disabled` Parsear button + a grey "se habilitará cuando se complete
  CI-11 (fn_parse_product_text)" callout. No fields are interactive.

**Server actions:** none. There is no `actions.ts` in the `/import` or
`/import/text` route folders, no `src/lib/actions/import*.ts`, and no
inline `'use server'` actions on either page. The CI-11 parser
(`fn_parse_product_text`) is referenced in the placeholder copy but no
DB function with that name has been verified to exist on
`ixbbhwtpnebrhquunege` — a forward-looking comment, not a wired call.

**Tables involved:**
- Read: `import_job` (recent-jobs list on `/import`).
- Write: none from this module on `main`.

**Known gaps:**
- Text-paste parser is not wired. The placeholder mentions
  `default_variant_axes` for variant detection, which was dropped from
  `category` in migration `20260426000003` — the comment is stale.
- Excel/CSV upload: no file picker, no column mapping screen.
- Migration import (WooCommerce, Shopify): disabled card with no body.
- No promotion UI for staged rows; if `import_staging` is ever populated
  out-of-band, there's no review/approve screen.
- `catalog_suggestion` has no triage UI.
- `import_job` query on the landing page selects columns
  (`import_job_id`, `source_label`, `total_rows`, `rows_promoted`,
  `rows_rejected`) that **don't exist** on the live table — the live
  table has `job_id`, no `source_label`, and no `rows_promoted` /
  `rows_rejected`. This will throw a Supabase error if any rows exist.
  As of now, the table is empty so the failure is invisible. Schema
  drift between `/import/page.tsx` and the actual table — needs
  reconciliation before the table gets data.

**Last touched:** PR #11 (initial scaffold). CI-11 was never delivered.

---

## Configuración → Algolia (`/configuration/algolia`)

**State:** full CRUD (credentials + verification).

**Routes:**
- `/configuration/algolia` — single-form layout. App ID, region (13-option
  dropdown), search API key, admin API key (Vault-stored, "Replace key"
  toggle), primary index. Test + Save buttons.

**Server actions** (`src/app/[locale]/(app)/configuration/algolia/actions.ts`):
- `testAlgoliaConnection(appId, adminKey)` →
  `{ ok, status, latencyMs, message? }` — pure HTTP probe; no DB writes.
- `saveAlgoliaConfig(payload)` →
  `{ ok, verified, httpStatus, latencyMs, error? }` — calls three RPCs
  (`algolia_save_credentials`, `algolia_get_admin_key`,
  `algolia_record_verification`) to persist the non-secret fields,
  retrieve the Vault-stored admin key when not being replaced, run the
  test, and record the verification result.

**Tables involved:** `instance.integrations_config` JSONB key
`algolia` (stores all non-secret fields + last verification metadata).
Admin key lives in Supabase Vault, accessed only through the
`algolia_*` RPCs.

**Known gaps:**
- The `Connection failed` toast doesn't surface the body of the Algolia
  error response — only `HTTP <status>`.
- No retry / circuit-breaker on the test request; one-off probe.

**Last touched:** PR #15.

---

## Configuración — Ajustes de la tienda

**State:** not built. Sidebar entry has `href: null`. There is no
`/configuration/store` route, no `instance` editor UI, no
`integrations_config` editor outside of the Algolia panel.

---

## Conversión → Embudo

**State:** not on main. The funnel feature lives on
`feat/funnel-diagram` (Phase 2 UI) — diagram canvas + inspector +
data-structure + maintenance tabs against the `funnel_*` schema. The
Phase 1 schema + seed merged via PR #25 (commit `b43157a`); the UI PR
is not yet open.

When that lands, this section will document `/funnel` and
`/funnel/[funnelInstanceSlug]` and the actions in
`src/lib/actions/funnel.ts`.

---

## Sistema → Estilo (`/styleguide`)

**State:** read-only — design tokens / primitives showcase. Internal
tool, no DB reads.

**Last touched:** PR #19.
