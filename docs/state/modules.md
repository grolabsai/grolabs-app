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

**State:** read-only (list + detail), variants rendered but not editable.

**Routes:**
- `/catalog/products` — paginated list with filter chips
  (all / active / inactive / consignment / service). Reads `product` joined
  with `product_type`, `brand`, and `product_variant + product_pricing`.
- `/catalog/products/[id]` — product detail. Two-column layout
  (Información básica / Configuración / Atributos on the left;
  gallery placeholder + summary card on the right). Variants table
  spans the bottom.

**Server actions:** none for products. Save/edit is not wired —
`/catalog/products/[id]` displays a "Solo lectura" strip and every input
is rendered with `disabled`. There is no `lib/actions/product*` file.

**Tables involved:**
- Read: `product`, `product_translation`, `product_type`,
  `product_type_translation`, `brand`, `product_variant`,
  `product_variant_attribute`, `product_pricing`, `product_media`,
  `product_attribute_value`, `product_attribute`, `product_attribute_option`,
  `product_category_link`, `category`.
- Write: none from this module on `main`. (PR #24 adds CRUD; not yet
  merged.)

**Known gaps:**
- Save buttons render but are `disabled title="Edición — próximamente"`.
- "Nueva variante" button is `disabled`.
- "Nueva categoría" / "Importar" buttons on the list are `disabled`.
- No image upload — gallery is a static "Sin imagen principal" placeholder.
- `product.manufacturer` is rendered as a disabled `<input>` next to the
  brand picker but never editable from the UI; see Sub-section: Manufacturer
  field below.

**Last touched:** PR #11 (read-only screen). PR #24 (CRUD) is open.

### Catalog → Products — variants + manufacturer detail

This expanded section is the foundation for the next feature work
(products + variants CRUD). PR #24 (open) builds on what's described
here.

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

**Where it renders.** As a disabled `<input>` on the product detail page
at [page.tsx:321-330](src/app/[locale]/(app)/catalog/products/[id]/page.tsx#L321-L330),
inside the "Configuración y proveedor" card, immediately below the brand
field. It is not rendered on the products list, the categories detail,
or any other route.

**Where it's edited.** Nowhere on `main`. There is no `updateManufacturer`
action; no other route writes the column; no import flow populates it.
The column is read-only by virtue of the entire detail page being
read-only.

**Existing `product_attribute` named "manufacturer"?** No. The seed
migrations (`20260422*` initial schema + the catalog seeds) do not insert
a row with `attribute_code = 'manufacturer'` on `product_attribute`. The
column is structurally a free-form text column on `product`, not an
attribute. Any migration that introduces an attribute-based manufacturer
concept would need to either (a) keep the column for legacy compatibility
and dual-write or (b) backfill from the column into a new attribute and
drop the column.

**`brand` has a manufacturer column?** No. The `brand` table has only
six columns: `brand_id`, `instance_id`, `brand_name`, `wazudb1_id`,
`created_at`, `updated_at`. There is no `brand.manufacturer`, no
`brand.manufacturer_brand_id`, no link table connecting brand to
manufacturer. If "manufacturer" is meant to be a separate normalised
entity (i.e., one manufacturer can have many brands), neither the table
nor the FK exists yet.

**Implications for the upcoming PR.** If the goal is to normalise
manufacturer:
1. Decide whether manufacturer is its own table (separate from `brand`)
   or a column on `brand`. The current free-text column on `product`
   gives no signal either way.
2. If introducing a new table or column, the migration is straightforward
   (add the table or column, RLS policy, FK on `product`). Backfilling
   from the existing free-text strings will require deduplication —
   names like "ACME Inc." vs "ACME Inc" vs "Acme inc." need a normalise
   step.
3. The `product.manufacturer` column should stay during transition; the
   editor can dual-write or read-prefer the new path. Drop only after
   the backfill verifies coverage.

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
