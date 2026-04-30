# Scout — In-flight (current state)

Generated 2026-04-30. Snapshot of open PRs, active branches, and known
debt. Update at the end of every PR that opens or closes work.

---

## Open PRs

| # | Title | Branch | Created |
|---|---|---|---|
| 24 | feat(catalog): products and variants CRUD | `feat/products-variants-crud` | 2026-04-28 |
| 23 | chore: update CLAUDE.md to reflect current state of repo | `chore/claude-md-current-state` | 2026-04-28 |
| 22 | design: standard Combobox component (search + click in one) | `design/combobox-standard` | 2026-04-27 |
| 17 | feat: attribute screen refactor + category attributes section + agent panel | `screens/attributes-and-category-attr-refactor` | 2026-04-27 |

Pulled via `gh pr list --state open`. Author for all four: `grolabsai`.

**Not yet open** (branches exist with commits ahead of main but no PR):
- `feat/funnel-diagram` — Phase 2 funnel UI (DiagramTab + canvas + tabs +
  maintenance CRUD). Builds on PR #25 (funnel schema, merged).
- `feat/funnel-template-electronics-short` — adds the "Electrónica
  corta" funnel template via a single migration.
- `chore/scout-state-docs` — this branch.

---

## Active branches (local + remote)

Pulled via `git branch -a --sort=-committerdate`. One-line gloss based on
branch name + most recent commit message.

| Branch | Status | Purpose |
|---|---|---|
| `chore/scout-state-docs` | local + remote (this branch) | docs/state/ system documentation |
| `feat/funnel-template-electronics-short` | local + remote | new "Electrónica corta" funnel template (migration only) |
| `feat/funnel-diagram` | local + remote | funnel UI Phase 2 (canvas + inspector + tabs + maintenance) |
| `main` | local + remote | trunk |
| `feat/funnel-schema` | local + remote | merged (PR #25), can be deleted |
| `feat/products-variants-crud` | local + remote | PR #24 — open |
| `chore/claude-md-current-state` | local + remote | PR #23 — open |
| `design/flatten-and-styleguide` | local + remote | merged (PR #19), can be deleted |
| `design/combobox-standard` | local + remote | PR #22 — open |
| `chore/claude-code-permissions` | local + remote | merged (PR #21), can be deleted |
| `design/inputs-always-white` | local + remote | merged (PR #20), can be deleted |
| `fix/instance-id-falsy-checks` | local + remote | merged (PR #18), can be deleted |
| `screens/attributes-and-category-attr-refactor` | local + remote | PR #17 — open |

---

## Known issues & debt

### Schema-level

- **Two tenancy patterns coexist.** Catalog and taxonomy tables use
  `instance_isolation_*` (four policies, no template fallthrough).
  Funnel per-tenant tables use the newer `tenant_read` +
  `tenant_write_all` (template fallthrough on SELECT, no template writes).
  Funnel shared tables use a third pattern
  (`shared_read_all_authenticated` + `shared_write_service_role_only`).
  Not actively broken, but worth knowing when designing future tables —
  the funnel patterns are the canonical shape going forward.

- **`product.manufacturer` is a free-form text column.** Not normalized,
  not editable from the UI, not surfaced as a `product_attribute`. PR #24
  (open) likely changes this. Documented in
  [docs/state/modules.md → Manufacturer field](modules.md).

- **`brand` table has only six columns.** No description, no logo, no
  manufacturer link. Any "brand vs manufacturer" distinction has nowhere
  to live yet.

- **Template fallthrough not consistent.** Catalog templates
  (`instance_id = 0` rows in `category`, `product_attribute`, etc.) are
  visible only via service-role — RLS blocks tenant SELECT. Funnel
  templates ARE visible via tenant SELECT thanks to the
  `instance_id = 0 OR membership` policy. If we later want catalog
  templates visible to tenants for "fork from template" flows, the
  policy shape will need to be ported over.

- **`scout_schema_version` has RLS disabled.** The only table where
  RLS is off. Used by ops only; not a functional issue, but it's the
  single exception in the schema.

- **Funnel shared-table writes have no app-level admin gate.** PR #25
  ships `service_role` write actions for `funnel_flow`, `funnel_stage`,
  `funnel_transition`, `funnel_friction_point`. Any authenticated user
  who calls a `funnel.ts` server action will succeed — there's no
  `instance_member.role` check yet because the role taxonomy isn't
  finalized. Tracked in `feat/funnel-diagram`'s pending §17 of CLAUDE.md.

- **Funnel per-tenant write policies use `tenant_write_all`.** Anyone
  with an `instance_member` row can INSERT / UPDATE / DELETE on funnel
  per-tenant data for that instance. Same `instance_member.role` debt as
  above.

### UI-level

- **Catalog → Products is read-only.** All inputs are `disabled`; the
  "Solo lectura" strip is rendered explicitly. PR #24 addresses this.

- **Variants have no detail screen.** The variants table is rendered
  inline on the product detail page, with no
  `/catalog/products/[id]/variants/[variantId]` route. PR #24 adds the
  detail route + edit forms.

- **Variant attribute values are fetched but not displayed.** The query
  on the product detail page joins `product_variant_attribute` but the
  variant table has fixed columns and ignores the attribute join.

- **Translations have no UI.** Every catalog table has a `_translation`
  sibling, but no admin form edits them. Translations are populated only
  by import flows (where they exist) and by the seed.

- **Excel/CSV import + migration import are placeholder cards.** Only
  text-paste import works.

- **Many catalog sidebar entries are disabled.** Marcas, Tipos de
  producto, Etiquetas, Reglas de coincidencia — all `href: null` in the
  sidebar.

- **Configuración → Ajustes de la tienda is not built.** No `/configuration/store`
  route; sidebar entry is disabled.

- **Pet-profile family has no UI.** Five tables exist
  (`pet_profile_attribute`, `pet_profile_attribute_option`,
  `pet_product_matching_rule`, plus two translations) and are populated
  for the Wazu instance, but no admin screen edits them.

- **Service-* family has no UI.** Five tables exist and are seeded for
  Wazu, but no admin screens for service packs, components, or supply
  recipes. The compositional schema is in place; the editor is not.

### Code-level (TODO comments in `main`)

- `src/app/[locale]/(app)/dashboard/page.tsx:16` — analytics subdomain
  mapping for regions `in / sg / au / br / ca / za / uae / uk / jp / hk`
  is unverified and falls back to `analytics.us.algolia.com`.
- `src/components/shell/TopBar.tsx:29` — `useRouter` from
  `next/navigation` should migrate to `@/i18n/routing` once all hrefs
  are locale-aware.
- `src/components/shell/Sidebar.tsx:35` — same migration TODO; sidebar
  uses `next/link` directly. New sidebar items added on
  `feat/funnel-diagram` route through the shared `<Icon>` wrapper, but
  the legacy items still use raw lucide imports.

### Naming debt

- **`instance.instance_id` sequence is still
  `tenant_tenant_id_seq`.** Pre-rename artifact; harmless but visible in
  the column default. Cleaning it up requires an ALTER SEQUENCE … RENAME.

- **`product.wazudb1_id` and `product_variant.wazudb1_id`** are migration
  refs from the old WazuDB1 system. Once the migration is fully cut over,
  these can be dropped.
