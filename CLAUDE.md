# Scout — Claude Code conventions

## 1. Repository layout

The Next.js application lives at the repo root (consolidated from `scout-admin/` in PR #11).

- **Local path:** `~/code/scout`
- **Production URL:** `app.grolabs.ai` — Vercel deploys `main` automatically
- **Vercel rule:** Never use "Promote to Production" manually. Production must always equal `main`. Promoting a preview deploy bypasses the deploy pipeline and breaks this invariant.

```
scout/
├── src/
│   ├── app/
│   │   └── [locale]/          ← all routes (login, (app)/catalog, (app)/import, …)
│   ├── components/
│   │   ├── ui/                ← shadcn/ui primitives + icon.tsx + floating-label-input.tsx + combobox.tsx
│   │   ├── shell/             ← Sidebar, TopBar, AgentPanel
│   │   └── catalog/           ← VariantAxisConfig, AttributeTypeGlyph, …
│   ├── i18n/
│   │   ├── routing.ts         ← defineRouting + locale-aware Link/redirect exports
│   │   └── request.ts         ← getRequestConfig (server-side message loading)
│   ├── lib/
│   │   ├── actions/           ← server actions (category.ts, …)
│   │   ├── supabase/          ← client helpers (server.ts, client.ts)
│   │   ├── instance.ts        ← currentInstanceId()
│   │   ├── resolveVariantAxes.ts
│   │   └── format.ts
│   └── middleware.ts          ← Supabase session refresh + next-intl locale routing
├── messages/
│   ├── es.json                ← primary translations (source of truth)
│   └── en.json                ← English translations (add keys here alongside es.json)
├── supabase/
│   └── migrations/            ← ordered SQL files, applied manually via Supabase MCP
├── docs/                      ← decision log, design prompts, entity inventory
├── global.d.ts                ← IntlMessages type (derived from es.json)
├── next.config.ts
├── tailwind.config.ts
└── components.json            ← shadcn/ui config
```

Live routes (as of latest main):
- `/catalog/products` — product list with filters
- `/catalog/products/[id]` — product detail (read-only, Phase 1)
- `/catalog/categories` — category tree + attribute/variant accordion detail
- `/catalog/attributes` — attribute definitions management
- `/configuration/algolia` — Algolia credentials + verification
- `/dashboard` — no-results analytics (Algolia-sourced)
- `/import` — import method picker
- `/import/text` — text-paste import (parser wired in CI-11)
- `/login` — authentication
- `/styleguide` — design token and component reference (dev only)

---

## 2. Multi-tenancy

The atomic data unit is **instance**, not tenant.

- Every operational table has `instance_id` (FK → `instance`). `tenant_id` appears on the `instances` table as a parent grouping — do not use it on data rows or in new queries.
- `instance_member(user_id, instance_id, role)` is the security perimeter. A user can belong to multiple instances; RLS reads `instance_id` from the JWT claim.
- Never write `WHERE instance_id = X` in application code. RLS enforces isolation automatically.
- The `service-role` Supabase client (bypasses RLS) is reserved for admin flows only: copy-on-signup, bulk imports, reconciliation. Never for normal reads.
- **Instance kinds:** `kind = 'template'` is the GRO Scout Template (instance 0), used as the seed source for copy-on-signup. `kind = 'customer'` instances own their data after provisioning. Template data is never visible to customers in normal operation.
- **URL convention:** `/scout/[instance_id]/...` — the instance ID appears in the URL path to scope all data operations.

### Instance ID checking

Scout's template instance has `instance_id = 0`. This is intentional — 0 is a meaningful, queryable database value. JavaScript treats `0` as falsy, which means `if (!instanceId)` silently breaks for any user on the template instance.

**Always use strict null/undefined checks for `instance_id` values:**

```ts
// ✅ Correct
if (instanceId === null) { ... }
if (instanceId === undefined) { ... }
if (instanceId == null) { ... }    // covers both null and undefined

// ❌ Wrong — evaluates true for instance 0
if (!instanceId) { ... }
if (instanceId) { ... }            // same trap, inverted
const id = instanceId || fallback; // collapses 0 to fallback
```

This applies to `category_id`, `attribute_id`, and any other database ID that can legitimately be 0. `currentInstanceId()` returns `number | null` — the null case means "unauthenticated or no membership found," not "zero."

```ts
// ✅ Correct — RLS handles the instance filter
const { data } = await supabase.from('category').select('*');

// ❌ Wrong — redundant and fragile
const { data } = await supabase.from('category').select('*').eq('instance_id', id);
// (The belt-and-suspenders .eq() in existing code is for explicitness, not correctness)
```

---

## 3. Component foundation

**Stack:** Next.js 15 · React 19 · Tailwind CSS v3.4 · shadcn/ui (Radix) · lucide-react · sonner · next-intl 4.9

Custom design tokens are defined as `.s-*` CSS custom properties in `src/app/globals.css`.

### shadcn/ui primitives

`src/components/ui/` — do not modify these files directly. All user-visible text passed into primitives must still come from `t()`.

Standard data surfaces use the `Card` primitive:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
```

### Surface elevation rules

**All data surfaces are flat — no box shadows.** This includes cards, panels, tables, and form sections.

**Transient elevation keeps shadows:** popovers, dropdowns, dialogs, and toasts retain their shadow to communicate z-position.

Focus rings on inputs are preserved for accessibility and are not "elevation" — do not remove them.

### Icon wrapper — mandatory for Lucide

Icons are stroke-only: no fills, no colors, no 3D effects.

```tsx
// ✅ Always use the wrapper
import { Icon } from '@/components/ui/icon';
import { ChevronRight } from 'lucide-react';

<Icon icon={ChevronRight} />          // 16px, strokeWidth 1.5 (defaults)
<Icon icon={ChevronRight} size={12} />

// ❌ Forbidden — raw Lucide without explicit size + strokeWidth
<ChevronRight />
<ChevronRight className="h-4 w-4" />
```

### Inline SVGs

Always set explicit `width` and `height`:

```tsx
// ✅
<svg width="16" height="16" viewBox="0 0 16 16">

// ❌ — falls back to the 1em safety net, which may be wrong
<svg viewBox="0 0 16 16">
```

`src/app/globals.css` has `svg { width: 1em; height: 1em; flex-shrink: 0; }` as a last-resort fallback. Do not rely on it.

### Form inputs

Use `FloatingLabelInput` from `src/components/ui/floating-label-input.tsx` for all form fields. The floating label cuts through the border, positioned absolute at `−7px` top with surface background color and horizontal padding.

**All form inputs have white backgrounds in every state** — default, hover, focus, and disabled. Disabled communicates via border tone and muted text color only, not a grey background.

### Input typography hierarchy

| Element | Size | Weight | Color |
|---|---|---|---|
| User content (typed value) | 15px | 500 | `#000` (pure black) |
| Floating label | 10px | 400 | `--s-text-tertiary` (muted) + `letter-spacing: 0.04em` |
| Hint / helper text | 11px | 400 | `--s-text-tertiary` (muted) |

15px for content also avoids iOS auto-zoom on focus (browser threshold is 16px; 15px is close enough not to trigger it in practice — test if changing).

### Combobox — mandatory for data-backed pickers

Any picker for values from a database-backed list (attributes, categories, tags, brands, anything dynamic) **must** use `Combobox` from `@/components/ui/combobox`:

```tsx
import { Combobox } from '@/components/ui/combobox';

// Single-select
<Combobox value={value} onValueChange={setValue} options={options} />

// Multi-select
<Combobox multiple value={values} onValueChange={setValues} options={options} />

// With create affordance
<Combobox ... onCreateNew={(label) => handleCreate(label)} />
```

Combobox supports search-as-you-type AND click-to-show-all in one component.

**Do not:** build custom typeaheads, use raw `<select>`, or use shadcn `Select` for data-backed pickers (it lacks search).

**Static enum lists** (e.g., picking `mass` / `volume` / `count` for a quantity attribute's dimension) **may** use shadcn `Select` since the values are hardcoded constants. Anything backed by a DB query must be `Combobox`.

### Toasts

Use `sonner` via `src/components/ui/sonner.tsx`. The `<Toaster />` is mounted in the root layout.

---

## 4. i18n

| Decision | Value |
|---|---|
| Default locale | `es` — clean URLs, no prefix |
| Supported locales | `['es', 'en']` |
| URL strategy | `localePrefix: 'as-needed'` |
| Canonical path segments | English ASCII (`catalog`, `products`, `configuration`) — labels translate, paths don't |
| Message source of truth | `messages/es.json` |
| Top nav (es) | Conversión · Catálogo · Configuración |
| Top nav (en) | Conversion · Catalog · Configuration |

**New screens add keys to both `messages/es.json` and `messages/en.json` in the same PR.** The English value may be a direct translation or a placeholder, but the key must exist in both files.

### Navigation utilities

`src/i18n/routing.ts` exports locale-aware `Link`, `redirect`, `usePathname`, `useRouter`. New screens use these; legacy screens use `next/navigation` and work only for `es`.

```ts
// ✅ New screens
import { Link, redirect } from '@/i18n/routing';

// ⚠️ Legacy — works for es only, migrate on touch
import Link from 'next/link';
```

### No hardcoded user-facing strings

Every user-visible string goes through `useTranslations` (client) or `getTranslations` (server). There is no ESLint plugin enforcing this — code review is the gate.

```tsx
// ❌ Forbidden
<h1>Catálogo</h1>
<button>Guardar</button>

// ✅ Correct
const t = useTranslations('nav');
<h1>{t('catalog')}</h1>
```

Exceptions (no i18n needed):
- `console.*` developer messages
- Database values rendered directly (product names, slugs, attribute names from DB)
- CSS class names, decorative `aria-label` values derived from data

---

## 5. Database is the source of truth — not code

Any UI element that **represents data** must be queried from the database. Hardcoded enum lists in components are forbidden.

```
Data labels    → DB query       (attribute names, category names, unit names, variant axes)
UI chrome      → i18n messages  (button labels, section titles, error messages)
Visual tokens  → Tailwind/CSS   (colors, spacing, border-radius)
```

**The test:** if two instances could legitimately have different values for a given string, it is data — query it.

```tsx
// ❌ Forbidden — hardcoded attribute list
const AXES = ['weight', 'volume', 'size', 'color'];

// ✅ Correct — query category_product_attribute for variant axes
const { data: axes } = await supabase
  .from('category_product_attribute')
  .select('*, product_attribute(attribute_code, attribute_name)')
  .eq('category_id', categoryId)
  .eq('is_variant_axis', true)
  .order('variant_axis_order');
```

This was the root cause of the variant axis chips showing English labels in Phase 1 (PR #14 fixed it). The same rule applies everywhere.

---

## 6. Module structure

Top-level nav sections (in order):

| Section | Key screens |
|---|---|
| Dashboard | No-results analytics, synonym creation |
| Catálogo | Products, Categories, (Attributes, Brands, Product types — Phase 2+) |
| Datos | Import (text, CSV, migration) |
| Referencias | Species, Breeds, Profile attributes (Phase 2+) |
| Configuración | Algolia, Store settings |

Modules are toggled via `instance.integrations_config` (JSONB). A module that isn't configured should not appear in the nav; a module that is coming soon shows a disabled item with a tooltip.

---

## 7. Integrations adapter pattern

Algolia is the first external integration. All future integrations follow the same shape.

**Credentials storage:** `instance.integrations_config` JSONB, one key per integration (`algolia`, `stripe`, …). Admin/write keys go through **Supabase Vault** — never stored in plaintext.

**Three RPCs per integration (Algolia example):**

```sql
algolia_save_credentials(p_instance_id, p_app_id, p_search_key, p_admin_key)
algolia_get_admin_key(p_instance_id) → text
algolia_record_verification(p_instance_id, p_latency_ms, p_status)
```

All RPCs are `SECURITY DEFINER` and check `instance_member` before acting.

**User-facing terminology:** "Admin API Key" is displayed as **write key** in the UI. Never expose "admin" to end users.

When adding a new integration:
1. Add credentials sub-key under `integrations_config`
2. Create three Vault-backed RPCs following the pattern above
3. Add a configuration screen at `/configuration/<integration-name>`
4. Gate the nav item on `integrations_config.<key>` being present

---

## 8. Quantity attributes

For any physical-measurement attribute (weight, volume, content/fill), use `data_type = 'quantity'`. This stores `value_number` (numeric) + `unit_id` (FK → `unit_of_measure`) on the value row.

**`unit_of_measure` table** — 8 seeded units:

| code | name | dimension | to_si_factor |
|---|---|---|---|
| g | Gramo | mass | 1 |
| kg | Kilogramo | mass | 1000 |
| oz | Onza | mass | 28.3495 |
| lb | Libra | mass | 453.592 |
| ml | Mililitro | volume | 1 |
| l | Litro | volume | 1000 |
| fl_oz | Onza líquida | volume | 29.5735 |
| ea | Unidad | count | 1 |

**Invariant:** `value_number × to_si_factor = SI base amount` (grams for mass, ml for volume).

Do not create separate `weight_kg` / `weight_lb` attributes. One `weight` attribute with `data_type = 'quantity'` covers all units. The `unit_of_measure` row carries the conversion factor.

---

## 9. Variant axes

Variant axes are stored in `category_product_attribute`, not on the category row.

```sql
-- ✅ Correct
SELECT cpa.*, pa.attribute_code, pa.attribute_name
FROM category_product_attribute cpa
JOIN product_attribute pa ON pa.attribute_id = cpa.attribute_id
WHERE cpa.category_id = $1
  AND cpa.instance_id = $2
  AND cpa.is_variant_axis = true
ORDER BY cpa.variant_axis_order;

-- ❌ Will throw — column was dropped
SELECT default_variant_axes FROM category;
```

`category.default_variant_axes` was dropped in migration `20260426000003`. Any code that reads it will get a Postgres error.

Resolution helper: `src/lib/resolveVariantAxes.ts` — takes pre-fetched `VariantAxisRow[]` and the flat category list, walks root → leaf, deduplicates by `attribute_code` (ancestor wins).

---

## 10. Inheritance with child override

Parent categories cascade their attribute and axis definitions to children. The application layer resolves the effective set at read time — the DB stores only the explicitly-defined rows.

**Algorithm** (implemented in `resolveVariantAxes`, generalize for all attributes):

1. Walk the category chain from root to the target leaf.
2. For each level, collect `category_product_attribute` rows.
3. If the same `attribute_id` appears at multiple levels, the **deepest** (leaf-closest) definition wins for that category.
4. Result: the leaf's effective attribute set = inherited + own overrides.

When displaying: show inherited rows as read-only with a source label. Own rows are editable. The same `<VariantAxisConfig>` pattern applies to all attribute cards.

---

## 11. Single source of truth for attribute definitions

Attributes are **defined once** on `/catalog/attributes`. Categories only link to existing attributes — they do not create attribute definitions inline.

**Variant axes are a property of the category-attribute link, not the attribute itself.** `category_product_attribute.is_variant_axis` (bool) and `category_product_attribute.variant_axis_order` (int) control this. The same `product_attribute` row can be a plain descriptive attribute in one category and a variant axis in another.

The same `product_attribute` row acts as:
- A descriptive attribute (`category_product_attribute.is_variant_axis = false`)
- A variant axis (`category_product_attribute.is_variant_axis = true`)
- A profile attribute (linked via a different bridge table)

**`product_attribute.applies_to_variants` was dropped** in the schema migration completed during the attributes refactor. Do not reference this column — it no longer exists.

Setting `category_product_attribute.is_variant_axis = true` promotes an existing attribute to a variant axis for that category. It does not duplicate the attribute definition.

---

## 12. Migration workflow

Migrations live in `supabase/migrations/` as timestamped SQL files. They **do not auto-apply on Vercel deploy**.

**Every prompt that ships a migration must:**

1. Write the SQL file in `supabase/migrations/`.
2. Apply it via `mcp__claude_ai_Supabase__apply_migration`.
3. Verify with `information_schema` or `pg_proc` queries — do not assume success.

```sql
-- Example verification after adding a column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'category_product_attribute'
  AND column_name = 'is_variant_axis';
```

A GitHub Action will automate this in a future iteration. Until then, apply manually and confirm.

---

## 13. Deployment

- **Production URL:** `app.grolabs.ai`
- Vercel deploys `main` automatically on every merge.
- **Never use "Promote to Production"** in Vercel. Production must always equal `main`. Manual promotion bypasses the pipeline and breaks this invariant.

Each deploy publishes a build SHA visible in:
- **Sidebar footer** — `Versión` block below the instance badge
- **Login page footer** — `Scout · <sha> · <date>`

SHA is set in `next.config.ts`:
```ts
env: {
  NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
},
```

Falls back to `dev` in local development. When debugging "is what I'm seeing deployed?" — check the footer SHA against the latest commit on main.

**Auth:** Unauthenticated requests are blocked in `src/app/[locale]/(app)/layout.tsx`, not in middleware. Middleware only refreshes the Supabase session cookie and routes locale.

---

## 14. Agent-oriented design

Every settings and management screen is designed to accommodate a natural-language agent panel on the right side. The agent prefills the form, shows "here's what I understood, here's what I'm about to do," and the user clicks the same Save button they would use manually.

**Current state:** placeholder component at `src/components/shell/AgentPanel.tsx`. The panel lives at app shell level (not per-screen) and persists across navigation. It is NOT a help dock — it's the agent's own narration channel. Real implementation queued.

**Future schema:** `agent_session`, `agent_event` (types: `status` / `finding` / `suggestion` / `question` / `user_reply` / `system`), `agent_directive`. All screen actions exposed as named operations callable by both form and agent.

**Two consequences that affect every screen built today:**

**a. Every action must be a named discrete operation.** Forms submit via server actions with explicit names (`updateVariantConfig`, `saveAlgoliaCredentials`, …). The agent will call the same actions the form does — not scrape the DOM.

**b. Reserve right-panel space from day 1.** Split layouts (tree on left, detail on right) already do this. For full-width screens, leave the right quarter empty rather than filling it — empty space is better than a layout that breaks when the agent panel arrives.

---

## 15. Living styleguide

The `/styleguide` route (`src/app/[locale]/(app)/styleguide/page.tsx`) is the canonical reference for design tokens and component patterns. It has 9 sections:

**Colores · Tipografía · Espaciado · Superficies · Botones · Inputs · Combobox · Iconos · Estados · Patrones de notas**

- When working on visual changes, verify against `/styleguide` in the browser.
- When adding new design tokens or component variants, update the styleguide in the same PR.
- The styleguide is the deliverable that proves a design change is complete and consistent.

---

## 16. Notion-first planning

Strategy and backlog live in Notion before they land in code. The top-level Scout page contains: Decisions, Tasks, Entity Inventory, and the "Catalog Intelligence — Build Plan" database.

**Top-level Projects DB:** `https://www.notion.so/38653c059b09451ea01c224335ac016c`

Before any Scout strategy or planning conversation, **first search Notion for "Scout"** and read the existing structure. Drafting without searching duplicates existing work.

---

## 17. Conventions checklist — enforce on every PR

| Rule | Detail |
|---|---|
| **Reachability** | Every shipped screen is navigable from the Sidebar. No URL-only access, no deliberately-hidden routes in live code. |
| **Column naming** | `instance_id` everywhere. Never `tenant_id` on data rows or new queries. |
| **Key naming** | `write_key` in user-facing UI, never `admin_key`. |
| **Translations** | All user-facing strings via `t()`. New keys added to both `es.json` and `en.json`. Scan JSX for string literals on every PR. |
| **DB as truth** | All data-derived options (attribute lists, unit lists, category lists) come from queries, never from hardcoded arrays. |
| **One definition** | Data is defined in one place; everything else links or references it. No duplicate definitions. |
| **Combobox for data pickers** | DB-backed pickers use `Combobox`. Static enum lists may use `Select`. Never raw `<select>` or custom typeahead. |
| **Flat surfaces** | Data surfaces have no box-shadow. Transient surfaces (popover, dropdown, dialog, toast) keep shadows. |
| **Input styling** | All inputs white in every state. Disabled communicates via border + text color, not background grey. |
| **Icon wrapper** | All Lucide icons go through `<Icon>`. Raw `<ChevronRight />` without `size` + `strokeWidth` is rejected. |
| **SVG dimensions** | All inline `<svg>` elements have explicit `width` and `height`. |
| **Migration applied** | Any PR that ships a migration must also show the Supabase MCP apply + verification in the PR description. |
| **Styleguide updated** | Any PR that introduces new design tokens or component variants updates `/styleguide` in the same PR. |
| **Build passes** | `npm run build` and `npm run typecheck` must pass before merge. No exceptions. |

---

## 18. Claude Code permissions

**`.claude/settings.json`** (committed, applies to all sessions on this repo) grants broad approval for common dev commands — git, npm, grep, sed, find, ls, tsc, mkdir, cp, mv, chmod, etc. — so these never prompt during normal work.

**Explicitly denied** (will always prompt/block regardless of other settings):
- Force pushes: `git push --force`, `git push -f`
- Push to main directly: `git push origin main`
- Checkout main directly: `git checkout main`
- Package publishing: `npm publish`, `yarn publish`
- Pipe-to-shell: `curl | sh`, `wget | sh`
- System-level: `sudo`, `rm -rf /`, `rm -rf ~`

**`.githooks/pre-push`** (enforced via `core.hooksPath = .githooks`) hard-blocks direct pushes to `main` at the git layer, independent of Claude Code settings.

To extend the allow/deny lists, edit `.claude/settings.json`. Machine-local overrides (MCP tool approvals, personal preferences) go in `.claude/settings.local.json` — that file is gitignored and never committed.

**Unattended sessions:** use `claude --dangerously-skip-permissions` to bypass all permission prompts. The deny list in `settings.json` and the `.githooks/pre-push` hook are the safety net when running with bypass mode.

---

## 19. Policy documents

Domain policy lives in `docs/policy/*.md`. These files are the source of truth for product behavior. When implementing a feature in those domains, read the relevant policy file first. When behavior needs to change, edit the policy file in the same commit as the code change.
