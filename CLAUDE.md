# GroLabs — Claude Code conventions

## 1. Repository layout

The Next.js application lives at the repo root (consolidated from `scout-admin/` in PR #11).

```
scout/
├── src/
│   ├── app/
│   │   └── [locale]/          ← all routes (login, (app)/catalog, (app)/import, …)
│   ├── components/
│   │   ├── ui/                ← shadcn/ui primitives + icon.tsx + floating-label-input.tsx
│   │   ├── shell/             ← Sidebar, TopBar
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
│   └── en.json                ← stub (populate per screen)
├── supabase/
│   └── migrations/            ← ordered SQL files, applied manually via Supabase MCP
├── docs/                      ← policy specs, decision log, design prompts, entity inventory
├── global.d.ts                ← IntlMessages type (derived from es.json)
├── next.config.ts
├── tailwind.config.ts
└── components.json            ← shadcn/ui config
```

Live routes (as of latest main):
- `/catalog/products` — product list with filters
- `/catalog/products/[id]` — product detail (read-only, Phase 1)
- `/catalog/categories` — category tree + attribute/variant accordion detail
- `/configuration/algolia` — Algolia credentials + verification
- `/dashboard` — no-results analytics (Algolia-sourced)
- `/import` — import method picker
- `/import/text` — text-paste import (parser wired in CI-11)
- `/login` — authentication

---

## 2. Multi-tenancy

The atomic data unit is **instance**, not tenant.

- Every operational table has `instance_id` (FK → `instance`). `tenant_id` appears only in the initial schema migration and legacy join tables — do not use it in new code.
- `instance_member` is the security perimeter. A user can belong to multiple instances; RLS reads `instance_id` from the JWT claim.
- Never write `WHERE instance_id = X` in application code. RLS enforces isolation automatically.
- The `service-role` Supabase client (bypasses RLS) is reserved for admin flows only: copy-on-signup, bulk imports, reconciliation. Never for normal reads.
- Template categories/attributes exist for seeding new instances during onboarding. They are never visible to tenants in normal operation.

### Instance ID checking

GroLabs's template instance has `instance_id = 0`. This is intentional — 0 is a meaningful, queryable database value. JavaScript treats `0` as falsy, which means `if (!instanceId)` silently breaks for any user on the template instance.

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

### shadcn/ui primitives

`src/components/ui/` — do not modify these files directly. All user-visible text passed into primitives must still come from `t()`.

Standard data surfaces use the `Card` primitive:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
```

### Icon wrapper — mandatory for Lucide

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

Use `FloatingLabelInput` from `src/components/ui/floating-label-input.tsx` for all form fields.

### Toasts

Use `sonner` via `src/components/ui/sonner.tsx`. The `<Toaster />` is mounted in the root layout.

---

## 4. i18n

| Decision | Value |
|---|---|
| Default locale | `es` — clean URLs, no prefix |
| Supported locales | `['es', 'en']` |
| URL strategy | `localePrefix: 'as-needed'` |
| Canonical path segments | English ASCII (`catalog`, `products`, `settings`) |
| Message source of truth | `messages/es.json` |

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

// ✅ Correct — query product_attribute WHERE applies_to_variants = true
const { data: attrs } = await supabase
  .from('product_attribute')
  .select('attribute_id, attribute_code, attribute_name')
  .eq('instance_id', instanceId)
  .eq('applies_to_variants', true)
  .eq('is_active', true)
  .order('attribute_name');
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

Attributes are **defined once** on the attributes management screen. Categories only link to existing attributes — they do not create attribute definitions inline.

The same `product_attribute` row acts as:
- A descriptive attribute (`is_variant_axis = false` in the link table)
- A variant axis (`is_variant_axis = true`)
- A profile attribute (linked via a different bridge table)

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

Vercel deploys from `main`. Each deploy publishes a build SHA visible in:
- **Sidebar footer** — `Versión` block below the instance badge
- **Login page footer** — `GroLabs · <sha> · <date>`

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

Every settings and management screen is designed to accommodate a future natural-language agent panel on the right side. The agent prefills the form, shows "here's what I understood, here's what I'm about to do," and the user clicks the same Save button they would use manually.

**Two consequences that affect every screen built today:**

**a. Every action must be a named discrete operation.** Forms submit via server actions with explicit names (`updateVariantConfig`, `saveAlgoliaCredentials`, …). The agent will call the same actions the form does — not scrape the DOM.

**b. Reserve right-panel space from day 1.** Split layouts (tree on left, detail on right) already do this. For full-width screens, leave the right quarter empty rather than filling it — empty space is better than a layout that breaks when the agent panel arrives.

---

## 15. Conventions checklist — enforce on every PR

| Rule | Detail |
|---|---|
| **Reachability** | Every shipped screen is navigable from the Sidebar. No URL-only access, no deliberately-hidden routes in live code. |
| **Column naming** | `instance_id` everywhere. Never `tenant_id` in new code. |
| **Key naming** | `write_key` in user-facing UI, never `admin_key`. |
| **Translations** | All user-facing strings via `t()`. Scan JSX for string literals on every PR. |
| **DB as truth** | All data-derived options (attribute lists, unit lists, category lists) come from queries, never from hardcoded arrays. |
| **One definition** | Data is defined in one place; everything else links or references it. No duplicate definitions. |
| **Icon wrapper** | All Lucide icons go through `<Icon>`. Raw `<ChevronRight />` without `size` + `strokeWidth` is rejected. |
| **SVG dimensions** | All inline `<svg>` elements have explicit `width` and `height`. |
| **Migration applied** | Any PR that ships a migration must also show the Supabase MCP apply + verification in the PR description. |
| **Build passes** | `npm run build` and `npm run typecheck` must pass before merge. No exceptions. |

---

## 16. Claude Code permissions

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

---

## 17. Known schema debt

Items here are intentional shortcuts or pre-rename artifacts that need follow-up. Update this list as debt is added or paid down.

- **`instance.instance_id` sequence still named `tenant_tenant_id_seq`** — pre-rename artifact in the column default. Functional but misnamed. Fix via `ALTER SEQUENCE … RENAME TO instance_instance_id_seq` next time we touch the `instance` table for another reason.

- **`instance.kind` is `text`, not an enum** — accepts `'customer'` and `'template'` by convention but with no DB-level enforcement. The funnel uses the `funnel_instance_type` enum for the same concept. Promote `instance.kind` to a real enum (`instance_kind`?) next time the `instance` table is migrated.

- **Catalog vs funnel template visibility asymmetry** — funnel per-tenant tables use `tenant_read` with template fallthrough on SELECT (`instance_id = 0` is visible to all authenticated users). Catalog tables use the older `instance_isolation_*` pattern with no template fallthrough — `instance_id = 0` rows in `category`, `product_attribute`, etc. are reachable only via `service_role`. If catalog template-forking becomes a feature (starter category trees, starter attributes for new tenants on signup), port the funnel pattern (`tenant_read` with template fallthrough on SELECT) to the catalog tables. Tracked in `docs/state/in-flight.md` → "Open architectural decisions".

- **Quantity attribute dimension filtering** — variant editor shows all units (mass, volume, count) in every quantity dropdown. No filtering by attribute dimension. To enable filtering: add a `dimension` column on `product_attribute` (`mass | volume | count`, nullable for non-quantity attributes — column already exists per migration `20260426000005_product_attribute_dimension.sql`, just unused by the editor), wire the variant editor to filter `unit_of_measure` rows by matching dimension. Cleanup of wrong-unit values entered before the migration is also required.

- **Funnel per-tenant write policies** — currently use `tenant_write_all` (any authenticated `instance_member` can INSERT/UPDATE/DELETE on their instance's funnel data). Tighten to role-gated policies when `instance_member.role` gating is wired up across GroLabs. Affected tables: `funnel_instance`, `funnel_dataset`, `funnel_dataset_transition_value`, `funnel_benchmark_source`, `funnel_friction_finding`.

- **Funnel shared-table writes via service-role** — mutations to `funnel_flow`, `funnel_stage`, `funnel_transition`, `funnel_friction_point` go through the service-role client (RLS allows only `service_role`). There is no app-level admin gate yet — any authenticated user calling a shared-write server action will succeed. Add an admin/owner role check in those actions when role taxonomy lands. Affected actions live in `src/lib/actions/funnel.ts` and reference this section in their TODO comments.

---

## 18. Policy documents

`docs/policy/` holds authoritative specs that must be read **before** writing code in the area they cover. Each policy doc is the single source of truth for one feature surface; implementation conversations reference it rather than restating decisions.

**Conventions:**

- One policy doc per feature surface, named `<feature>.md` (e.g. `search-foundations.md`).
- Frontmatter at the top: `Status:` (`Active policy` / `Superseded` / `Draft`), `Owner:`, `Scope:`, `Audience:`.
- Decisions in a policy doc are **locked**. If implementation reveals a flaw, raise it as a question — don't work around it silently.
- Approval checkpoints are marked `APPROVAL REQUIRED` inside the doc. Stop and wait for explicit approval at each one.
- See `docs/policy/README.md` for the current index.

**Active policy docs:**

- [`search-foundations.md`](docs/policy/search-foundations.md) — Stages 0 & 1 of the search roadmap. Foundations + basic search live on Wazú via Meilisearch Cloud. Read before any search-related implementation.
- [`search-events.md`](docs/policy/search-events.md) — Stage 4. Click + conversion event flow from the WP storefront direct to Meilisearch's analytics API. **Scout mints the tenant token, does NOT persist events.** Event data lives in Meilisearch Cloud's analytics dashboard — not in any Supabase table. Read this BEFORE searching the codebase for an `events` table or assuming click tracking is unimplemented; it isn't, it just doesn't live where you'd expect.
- [`wc-import.md`](docs/policy/wc-import.md) — One-way pull from WooCommerce into GroLabs's catalog tables (categories + products). v1 is raw preservation only; enrichment, variant restructuring, and category matching are explicitly deferred to future processes.
- [`ga4-integration.md`](docs/policy/ga4-integration.md) — Read-only Google Analytics 4 integration. Hybrid storage (daily snapshots in GroLabs DB + on-demand real-time queries). Alert pipeline for top-3 traffic-health metrics. New `/dashboard/traffic` surface as part of the multi-section dashboard described in [`docs/design/dashboard.md`](docs/design/dashboard.md).
- [`instance-management.md`](docs/policy/instance-management.md) — Multi-instance support: a single logged-in user can belong to multiple instances, switch via a topbar dropdown, and create new ones. Adds `instance_member.is_current` boolean with partial unique index per user. Replaces the `.maybeSingle()` on `is_active` ambiguity. Anyone can create an instance and becomes its owner; v1 instances start empty (no template seeding).
- [`tenant-model.md`](docs/policy/tenant-model.md) — Tenant layer above `instance`. New `tenant` table with `kind` (`template_owner` | `customer`) and `instance.tenant_id` FK. An instance is a template iff its tenant is `template_owner`. `instance.kind` is deprecated (kept + sync-trigger during the deprecation window); new code reads `tenant.kind` via the join. Seeded: GroLabs owns instance 0; Wazú owns instances 1 and 3.
- [`blog.md`](docs/policy/blog.md) — Multi-tenant blog. Single `post` table (RLS: anon can read `status='published'`); admin at `/content/posts`, public reading at `/blog/[slug]`. **v1 + v2 + v3 shipped** + **AI writing assist (DIY, no Tiptap Pro)**: Tiptap editor (HTML stored as text, sanitized via DOMPurify on read), markdown back-compat for v1 posts (`content_format` column), autosave, drafts/scheduled/published via Supabase pg_cron (5-min granularity), tags (`text[]` + GIN), TOC, reading time, `sitemap.xml`/`rss.xml`/`llms.txt`, host-based instance routing via `instance.domain`, **next/og** branded fallback when a post has no cover image, `next/image` for cover optimization (`next.config.ts` whitelists `*.supabase.co`), alt-text prompt on inline image upload. AI features call Claude Opus 4.7 via `@anthropic-ai/sdk` (server actions in `src/lib/actions/blog-ai.ts`, prompt loading + rendering in `src/lib/ai/blog.ts`); key in `ANTHROPIC_API_KEY` env var. **Prompts live in `prompt_template` table** (not code) — system prompt, voice guide, per-operation user prompts, rewrite instructions all editable via Supabase Studio without a deploy. Resolution: writer's `instance_id` wins, instance 0 is the fallback. Same rule applies to anything the consulting agent or future agents load — archetype catalogs, interview scripts, framework definitions all go to DB. Secrets (API keys, cron secret) stay in env. **Backlog (directional):** consulting agent (Brunson Attractive Character + outline + polish loop with per-post `writing_strategy` JSONB), per-instance `brand_system` (voice guide, colors, fonts), `research_task` table (agent-dispatched data backfills for a draft), image upload pipeline with brand-aware transforms (recolor / restyle / SVG-ify) — read the doc before scoping any of these.
- [`prospectos.md`](docs/policy/prospectos.md) — Internet-wide ecommerce diagnostic. Takes a URL, scores the storefront against a DB-driven rubric, computes annual revenue uplift, surfaces fix recommendations. **Two-service architecture:** Scout orchestrates + scores; ASE (`grolabsai/grolabs-ASE`, formerly grolabsai/glpimbk) owns the static-HTML signal-extraction primitives (`POST /tools/pdp-signals`, `POST /tools/site-signals`). **Catalog tables** (prompt_template pattern, per-instance + instance-0 fallthrough): `diagnostic_check`, `fix_recommendation`, `vertical_benchmark`, `vertical_synonym_pair`, `vertical_test_query`, `vertical_expected_attribute`. **Run tables**: `prospect`, `diagnostic_run` (uuid PK = share token), `run_sample`, `finding`, `finding_fix`. **Public anonymous API** (`POST /api/v1/diagnostic/runs`, `/diagnostics/[runId]`) for the landing-page widget; rate-limited via `record_diagnostic_request(p_ip)` RPC (5/hr, 20/day). **Vertical auto-detection** layered: keyword scoring on `vertical.detection_keywords[]`, Haiku tie-breaker only when ambiguous. **Sample auto-discovery** picks a featured PDP + a category link from the homepage when not supplied. **Browser probe** (Playwright via Browserless) gated on `PROSPECTOS_BROWSER_PROBE_ENABLED=1` + `BROWSERLESS_HOST` (e.g. `production-sfo.browserless.io`) + `BROWSERLESS_TOKEN` — Scout assembles `wss://<host>?token=<token>` at runtime, so region/private-fleet swaps don't need a code change. When the flag is off or either var is missing, browser-driven scorers report `result_status='na'`. **Core Web Vitals** via Google PSI (`PROSPECTOS_PSI_ENABLED=0` to disable; `GOOGLE_PSI_API_KEY` optional). **Revenue formula**: `uplift = traffic × stage_share × baseline_cr × aov × delta_rate × (1 − score/100)` per finding, summed for the run. Vocabulary editor at `/prospects/rubric/vocabulary`. Read this doc before touching anything under `src/lib/diagnostic/**`, `/prospects/**`, `/diagnostics/**`, or `/api/v1/diagnostic/**`.
