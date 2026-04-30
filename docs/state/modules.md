# Scout — Modules (current state)

Generated 2026-04-30. One section per functional module. Reflects what's
in `main` (HEAD = `b43157a`).

---

## Authentication (`/login`)

**State:** scaffolded only

**Routes:**
- `/login` — Supabase email-link authentication landing.

**Server actions:** none. Auth handshake goes through `@supabase/ssr`
client/server helpers in `src/lib/supabase/`.

**Tables involved:** `auth.users` (Supabase-managed), `instance_member` (read in
`(app)/layout.tsx` to resolve the active instance and surface its name in
the sidebar).

**Known gaps:**
- No password reset UI; password resets happen via the Supabase admin API
  (used out-of-band by ops).
- No SSO/Google login wired.

**Last touched:** PR #1 (initial scaffold).

---

## Dashboard (`/dashboard`)

**State:** read-only

**Routes:**
- `/dashboard` — Algolia "no-results" analytics; surfaces top zero-result
  searches over a configurable window (24h / 7d / 30d) and offers a
  "create synonym" dialog.

**Server actions:** present inline in the route folder (synonym creation
posts to the Algolia REST API; not a DB write). No file in
`src/lib/actions/` for dashboard.

**Tables involved:** `instance.integrations_config` (read to resolve the
Algolia App ID + key + index for the current tenant).

**Known gaps:**
- The synonym dialog is wired but the analytics subdomain mapping has a
  TODO at [page.tsx:16](src/app/[locale]/(app)/dashboard/page.tsx#L16) for
  the `in / sg / au / br / ca / za / uae / uk / jp / hk` regions — they
  all currently fall back to `analytics.us.algolia.com`.
- "Catalog alerts" panel is a placeholder (no data source yet).
- The Algolia request fires from the server with the admin key in plain
  HTTP — fine because it never crosses to the browser, but worth
  documenting for any future review of the request path.

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

(See "Catalog → Products — variants + manufacturer detail" below for the
deeper sub-sections that scope the next slice of work.)

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

**State:** partial — text-paste path active; Excel and migration paths
are placeholder cards.

**Routes:**
- `/import` — landing with three method cards (text / Excel / migration).
  Excel and migration cards are disabled. Recent imports list reads
  `import_job` rows.
- `/import/text` — paste-and-go form. Submitting calls the parser and
  promotes rows into staging.

**Server actions:** present inline in the `/import/text` route folder
(parser actions). No file in `src/lib/actions/`.

**Tables involved:** `import_job`, `import_staging`, `catalog_suggestion`
(write); reads `category` for the target-category picker.

**Known gaps:**
- Excel/CSV upload UI is a `disabled` card — no file picker, no column
  mapping screen.
- Migration import (WooCommerce, Shopify) is also a `disabled` card.
- No promotion UI for staged rows — once the parser writes to
  `import_staging` you can see them on the recent-jobs list, but there's
  no review/approve screen yet.
- `catalog_suggestion` is populated by parsing but has no UI to triage
  pending suggestions (no `/import/suggestions` route).

**Last touched:** PR #11 / CI-11 (text-paste parser).

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
