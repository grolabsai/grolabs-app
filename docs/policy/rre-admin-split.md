---
application: core-app
module: Policy
title: "RRE / Admin host split — policy (Draft)"
status: Draft
owner: "Tuncho"
scope: "Split the single GroLabs app surface into two host-routed destinations — `app.grolabs.ai` (RRE, the user-facing app) and `admin.grolabs.ai` (the GroLabs admin surface owning blog authoring and the prospects menu; the public style-guide page is linked from the admin nav only) — served from the SAME single Next.js deployable via route-group separation + host-based routing."
audience: "Claude Code (primary), future GroLabs contributors touching `src/middleware.ts`, the `[locale]` route tree, `src/components/shell/*`, or any of the routes that move."

actors:
  - name: RRE shell
    type: system
    definition: The (app) route group rendered for app.grolabs.ai — dashboard, catalog, pricing, data/sync, search + GA4 configuration.
  - name: Admin shell
    type: system
    definition: The new (admin) route group rendered for admin.grolabs.ai — blog authoring and the prospects menu, with a link to the public style guide.
  - name: Middleware
    type: system
    definition: src/middleware.ts; reads the host (host/x-forwarded-host) and rewrites admin.grolabs.ai requests into the (admin) group, leaving all other hosts in (app).
  - name: GroLabs staff
    type: human
    definition: The conceptual admin-surface user — a member of the GroLabs/template tenant (instance 0). Not hard-enforced in Phase 1.
  - name: Authenticated user
    type: human
    definition: Any logged-in Supabase user; in Phase 1 may reach either host.

users:
  - name: GroLabs staff
    description: Uses admin.grolabs.ai to author blog posts and manage prospects.
  - name: RRE user
    description: Uses app.grolabs.ai for the Revenue Recovery Engine surfaces.

permissions:
  - actorId: Authenticated user
    capability: access-admin-host
    effect: conditional
    note: Phase 1 grants any authenticated user; a default-granted isGroLabsAdmin(user) checkpoint in (admin)/layout.tsx is ready to flip on when role taxonomy lands.
  - actorId: GroLabs staff
    capability: access-admin-host
    effect: allow
    note: The modeled (not yet enforced) authorization — membership in the GroLabs/template tenant.

integrations:
  - name: instance.domain
    kind: internal-module
    target: instance
    direction: in
    purpose: Host-routes a tenant's public blog/sitemap/rss/llms.txt; untouched by this split (admin host is a constant, not tenant data).

rules:
  - id: R-1
    statement: Both app.grolabs.ai and admin.grolabs.ai resolve to the same single Next.js deployable; the split is route-group separation plus host-based middleware routing inside one app (Constitution Article 2).
    truth: unverified
    rationale: This doc is a proposal awaiting ratification; the migration runs only after approval.
  - id: R-2
    statement: Both (app) and (admin) are parenthesized route groups, so a path like /content/posts is identical regardless of group — the host, not the path prefix, distinguishes the surfaces.
    truth: unverified
  - id: R-3
    statement: The admin host is resolved in middleware against a static allow-list constant (admin.grolabs.ai) reading host/x-forwarded-host, not via a DB lookup.
    truth: unverified
  - id: R-4
    statement: Both hosts require a logged-in Supabase user; unauthenticated requests redirect to /login.
    truth: unverified
  - id: R-5
    statement: Phase-1 admin authorization grants any authenticated user, with a default-granted isGroLabsAdmin(user) checkpoint in (admin)/layout.tsx to enforce when role taxonomy lands (Article 7).
    truth: unverified
    rationale: This is the deferred security item SEC-001 referenced by the backlog-registry proposal.
  - id: R-6
    statement: /styleguide moves out of the gated group to a public location (like /legal), reachable by anyone with the URL, and is linked only from the admin nav, never from RRE.
    truth: unverified
  - id: R-7
    statement: Public /blog/[slug] and /diagnostics/[runId] stay public-shared and are not admin; only the blog authoring UI (/content/posts) moves to the admin surface.
    truth: unverified
  - id: R-8
    statement: No schema or migration change is required — the admin host is an infrastructure allow-list constant, not tenant data.
    truth: unverified

useCases:
  - id: T-1
    title: Admin routes are absent from the RRE host
    given: The migration has run
    when: A user browses app.grolabs.ai
    then: /content/posts and /prospects 404 and no admin or style-guide links appear in the RRE nav
    verifies: [R-7]
  - id: T-2
    title: Admin host shows only its sections
    given: The migration has run
    when: A user browses admin.grolabs.ai
    then: Only Blog and Prospectos render, with a working link out to /styleguide
  - id: T-3
    title: Style guide is public on any host
    given: /styleguide has moved out of the gated group
    when: An unauthenticated visitor opens it on any host
    then: It renders without requiring login
    verifies: [R-6]
  - id: T-4
    title: Public surfaces are unchanged by the split
    given: The migration has run
    when: Public /blog/[slug] and /diagnostics/[runId] are requested on either host
    then: They behave identically to before
    verifies: [R-7]
---

# RRE / Admin host split — policy (Draft)

This is a **proposal awaiting ratification** under Constitution Article 10.
It describes a route-group reorganization, not code to ship. No code or
schema change is implied by merging this doc; an implementation session
executes the migration plan after approval.

---

## 1. Summary & goal

Today the app is one Next.js 15 (App Router) deployable. Every
authenticated screen lives under a single `(app)` route group at
`src/app/[locale]/(app)/`, gated by one auth layout, with one Sidebar.
This spec splits the *surface* into two host-routed destinations served
by that **same single codebase and deployable**:
**`app.grolabs.ai`** renders **RRE** (Revenue Recovery Engine — the
main user-facing app: dashboard, catalog, pricing, data/sync, search +
GA4 configuration), and **`admin.grolabs.ai`** renders the **GroLabs
admin surface**, which owns exactly two things for now — the blog posts
authoring UI (`/content/posts`) and the full prospects menu
(`/prospects/**`). The GroLabs style-guide page (`/styleguide`) is
**public** — viewable by anyone with the URL, like `/legal/**` — but is
reachable through a link in the **admin nav only**, never linked from
RRE. Both hosts resolve to one Vercel deployment; the host
header selects which route group (and shell) renders. This honors
Constitution Article 2 (one core codebase, one schema, one deployable)
and the prior explicit decision that **admin is a route group inside the
single app, not a separate `web-apps/admin` folder**.

> **Note (added with [`user-management.md`](user-management.md)):** the
> admin surface gains a third section beyond blog + prospects — a
> **"Clientes"** screen where GroLabs staff provision customers (create a
> tenant + `domain` + first instance + first Tenant Admin). It lives in
> the same `(admin)` group and is gated by the now-real `isGroLabsAdmin()`
> (see §5). The shared `/login` also gains Google + Microsoft SSO buttons
> per that spec; `/login` remains shared across both hosts (§4).

---

## 2. Current-state map

Verified against the live route tree (`src/app/[locale]/`), the auth
gate (`src/app/[locale]/(app)/layout.tsx`), the Sidebar
(`src/components/shell/Sidebar.tsx`), the policy docs (`blog.md`,
`prospectos.md`), and the per-page Supabase client usage.

| Route / module | Current location | Auth today | Target surface |
|---|---|---|---|
| `/dashboard`, `/dashboard/traffic` | `(app)` | gated | **RRE** |
| `/funnel`, `/funnel/[slug]` | `(app)` | gated | **RRE** |
| `/catalog/**` (products, categories, attributes, brands) | `(app)` | gated | **RRE** |
| `/pricing/**` | `(app)` | gated | **RRE** |
| `/import/**`, `/sync` | `(app)` | gated | **RRE** |
| `/configuration/**` (algolia, search, ga4, woocommerce, system-health) | `(app)` | gated | **RRE** |
| `/content/posts`, `/content/posts/new`, `/content/posts/[id]` | `(app)` | gated | **ADMIN** (blog authoring UI) |
| `/prospects` (list + `_new-run-form`) | `(app)` | gated | **ADMIN** |
| `/prospects/[prospectId]` + `/pages/[pageId]` + `/vocabulary` | `(app)` | gated | **ADMIN** |
| `/prospects/runs/[runId]` (authenticated run viewer) | `(app)` | gated | **ADMIN** |
| `/prospects/rubric`, `/prospects/rubric/vocabulary` | `(app)` | gated | **ADMIN** |
| `/prospects/benchmarks` | `(app)` | gated | **ADMIN** |
| `/styleguide` (renders `--gl-*` tokens + components) | `(app)` | gated → **public** | **public-shared** (link in admin nav only; none in RRE) |
| `/login` | `[locale]` (outside `(app)`) | public | **shared** (both hosts) |
| `/blog`, `/blog/[slug]`, `/blog/tag/[tag]`, `/blog/preview/**` | `[locale]` (outside `(app)`) | anonymous | **public-shared** (host-routed to a tenant domain via `instance.domain`, NOT to admin) |
| `/diagnostics/[runId]` (public anonymous report; service-role) | `[locale]` (outside `(app)`) | anonymous | **public-shared** (landing-page widget report) |
| `/legal/**` | `[locale]` (outside `(app)`) | public | **public-shared** |
| `POST /api/v1/diagnostic/runs`, `GET .../runs/[runId]` | `api/v1` | anonymous (service-role + per-IP RPC) | **public-shared** (landing widget API) |
| `/api/v1/search`, `/api/v1/search/token`, `/api/v1/events`, `/api/v1/events/token` | `api/v1` | storefront/plugin | **public-shared** (storefront-facing) |
| `/api/v1/integrations/ga4/**`, `/api/v1/blog/publish-due` | `api/v1` | OAuth / cron-secret | **shared backend** |
| `/sitemap.ts`, `/robots.ts`, `/rss.xml`, `/llms.txt`, `/s/[code]` | `src/app/` root | public, host-aware | **public-shared** |

Key distinctions worth stating explicitly (asked for in the brief):

- **`/prospects/**` is entirely admin-side management.** Every prospects
  page uses `createClient` + `currentInstanceId` (authenticated, inside
  `(app)`). This includes the authenticated run viewer
  `/prospects/runs/[runId]`, the per-prospect vocabulary editor
  `/prospects/[prospectId]/vocabulary`, the global rubric vocabulary
  editor `/prospects/rubric/vocabulary`, and `/prospects/benchmarks`.
- **`/diagnostics/[runId]` is NOT admin.** It is the anonymous public
  report for the landing-page widget — it reads via the service-role
  client by unguessable UUID token and lives *outside* `(app)`. It stays
  public-shared. Likewise the `POST /api/v1/diagnostic/runs` +
  `GET /api/v1/diagnostic/runs/[runId]` widget API is public-shared.
  (`prospectos.md` §9 + §4 confirm the anon access model.)
- **Public `/blog/[slug]` reading is NOT admin** — it is host-routed by
  `instance.domain` to a *tenant's* public blog (per `blog.md` §3/v3),
  not to `admin.grolabs.ai`. Only the **authoring UI** at `/content/posts`
  moves to admin.

---

## 3. Proposed target architecture

### 3.1 Route-group layout

Introduce an `(admin)` route group as a sibling of the existing `(app)`
group, both under `[locale]`:

```
src/app/[locale]/
├── (app)/            ← RRE shell (auth gate + Sidebar + TopBar + AgentPanel)
│   ├── layout.tsx    (unchanged: RRE auth gate + RRE nav)
│   ├── dashboard/ catalog/ pricing/ import/ sync/ configuration/ funnel/ …
│   └── …
├── (admin)/          ← NEW. Admin shell (own auth gate + own Sidebar/nav)
│   ├── layout.tsx    (NEW: admin auth gate + admin nav)
│   ├── content/posts/…       (moved from (app))
│   └── prospects/…           (moved from (app))
├── styleguide/       ← NEW location: PUBLIC, outside both groups (moved out of (app)); linked from admin nav only
├── blog/             ← public-shared, unchanged
├── diagnostics/      ← public-shared, unchanged
├── legal/  login/    ← public-shared, unchanged
```

Both `(app)` and `(admin)` are parenthesized groups, so they do **not**
appear in the URL — `/content/posts` stays `/content/posts` regardless
of which group owns it. This matters: the host, not the path prefix,
distinguishes the two surfaces.

### 3.2 Host → route-group mapping

| Host | Renders | Default landing |
|---|---|---|
| `app.grolabs.ai` (+ `grolabs.ai`, previews, localhost) | `(app)` group (RRE) | `/dashboard` |
| `admin.grolabs.ai` | `(admin)` group | `/prospects` (or `/content/posts`) |
| a tenant's bound `instance.domain` (e.g. `wazu.com`) | public `/blog/**`, sitemap, rss, llms.txt | — |

The admin-host root redirect is **auth-aware**: an authenticated visitor
lands on `/prospects`, an unauthenticated one on `/login` (never bounced
through a protected admin page). Middleware also sends an unauthenticated
hit on any `(admin)` path straight to `/login`, so the §2.2 invariant
("unauthenticated requests redirect to /login") holds at the host root, not
just inside the layout. Login itself lands on `/` — middleware then routes
per-host — rather than a hardcoded `/dashboard`, which is RRE-only and 404s
on the admin host.

Because both `(app)` and `(admin)` resolve the same path segments,
collisions are impossible *within a host* — only one group is ever
mounted per host. The host decision happens once, in middleware.

### 3.3 How middleware resolves host → group

Follow the established host-routing precedent. The blog already reads
the host header in `src/lib/blog/host.ts` (`instanceIdForHost()` —
`headers().get("host") ?? get("x-forwarded-host")`, lowercased + port
stripped, looked up against `instance.domain`). The `s/[code]`,
`sitemap.ts`, `robots.ts`, `rss.xml`, `llms.txt` routes use the same
`host`/`x-forwarded-host` read. The admin host follows the same spirit.

Recommended mechanism — a **middleware rewrite** in `src/middleware.ts`,
keyed on a small static allow-list constant (`admin.grolabs.ai`), NOT a
DB lookup (the admin host is infrastructure config, not tenant data, and
the existing middleware deliberately avoids DB calls beyond the Supabase
session refresh):

1. `src/middleware.ts` runs `intlMiddleware` (unchanged) and refreshes
   the Supabase session (unchanged).
2. New step: read the host. If it is `admin.grolabs.ai`, rewrite the
   pathname so the request resolves into the `(admin)` group; otherwise
   leave it in `(app)`.

Two viable rewrite shapes — the implementation session picks one:

- **(A) Distinct path roots per group** — drop the `(admin)` parentheses
  and give admin a real (but hidden-from-user) prefix internally, with
  middleware rewriting `admin.grolabs.ai/content/posts` →
  `/content/posts` under the admin tree. Cleaner mental model; requires
  a rewrite map.
- **(B) Group via a header/rewrite marker** — keep both as `()` groups
  and use a middleware `rewrite` to a marker segment the route groups
  read. Next.js resolves route groups by file layout, so the simplest
  concrete form is (A): the admin routes live under a non-parenthesized
  internal segment that the user never sees because middleware rewrites
  to it. **Decision deferred to implementation; behavior is identical.**

The host read must use `x-forwarded-host` as a fallback (Vercel sets it),
exactly as the blog helpers do.

### 3.4 Shells & nav separation

The two surfaces **each get their own shell** — they share UI primitives
(`src/components/ui/*`, the `Icon` wrapper, `Card`, the design tokens)
but not the same chrome:

- **RRE shell** = the existing `(app)/layout.tsx` + `Sidebar` with the
  current nav groups (Dashboard, Conversion/funnel, Catálogo, Pricing,
  Datos, Configuración, References) **minus** the moved sections.
- **Admin shell** = a new `(admin)/layout.tsx` with its own auth gate and
  a dedicated admin Sidebar exposing **Contenido → Blog**
  (`/content/posts`), **Prospectos** (list, rubric, benchmarks — same
  children as today), and a **Sistema → Estilo** link pointing at the
  **public** `/styleguide` page. That style-guide link appears **only**
  in the admin nav; the RRE Sidebar has no style-guide entry.
  The shared `Sidebar.tsx` is currently one component
  with a hardcoded `NAV` array; the cleanest split is to extract the
  `NAV` config and pass a `nav` prop (or render two thin wrappers around
  a shared `<SidebarShell>`), so TopBar/AgentPanel/InstanceSwitcher and
  the collapse/persistence logic stay shared. This is a refactor, not a
  rewrite — same component, two nav configs.

The `nav.content`, `nav.blog`, `nav.prospects*`, and `nav.styleguide`
i18n keys already exist in `messages/es.json` and simply move with their
sections into the admin nav config.

---

## 4. What moves vs. what stays

**Moves to `(admin)` (admin.grolabs.ai):**

- **Blog posts UI** — `content/posts/`, `content/posts/new/`,
  `content/posts/[id]/` (the `(app)`-gated authoring screens from
  `blog.md` §3). The blog server actions (`src/lib/actions/blog*.ts`,
  `src/lib/ai/blog.ts`) are shared library code and do not move; only the
  route pages relocate.
- **Full prospects menu** — the complete set found in the tree:
  - `prospects/` (list + `_new-run-form`)
  - `prospects/[prospectId]/` and `prospects/[prospectId]/pages/[pageId]/`
  - `prospects/[prospectId]/vocabulary/` (per-prospect vocabulary editor)
  - `prospects/runs/[runId]/` (authenticated run viewer)
  - `prospects/rubric/` and `prospects/rubric/vocabulary/` (rubric +
    global vocabulary editor — `prospectos.md` §6 / `/prospects/rubric/vocabulary`)
  - `prospects/benchmarks/`
  - Backing library `src/lib/diagnostic/**` is shared and stays put.

The **style-guide page** does NOT move into `(admin)` — it moves *out*
of the gated group to a public location (see below).

**Stays in `(app)` (app.grolabs.ai) — RRE:** everything else —
`dashboard`, `funnel`, `catalog`, `pricing`, `import`, `sync`,
`configuration` (including `configuration/search`'s events panel).

**Genuinely shared (neither host's `(app)`/`(admin)` group; live outside
both, host-agnostic or tenant-domain-routed):**

- `/styleguide` — **public** style-guide visualization (renders the
  `--gl-*` tokens + component gallery; source-of-truth dictionary is
  `docs/design/design-tokens.md`). Moved out of `(app)` to a public
  location like `/legal/**`; no auth. Linked from the admin nav only,
  never from RRE.
- Public `/blog`, `/blog/[slug]`, `/blog/tag/[tag]`, `/blog/preview/**`
  — anonymous reading, host-routed to a tenant's `instance.domain`.
- `/diagnostics/[runId]` — anonymous public diagnostic report (landing
  widget), service-role + UUID token.
- `POST /api/v1/diagnostic/runs` + `GET .../[runId]` — public widget API.
- `/api/v1/search*`, `/api/v1/events*` — storefront/plugin-facing.
- `/api/v1/integrations/ga4/**`, `/api/v1/blog/publish-due` — backend.
- `/sitemap.ts`, `/robots.ts`, `/rss.xml`, `/llms.txt`, `/s/[code]`,
  `/legal/**`, `/login`.

These keep their current behavior. `/login` is reachable from both hosts
(both shells redirect unauthenticated users to it).

---

## 5. Auth / access implications

The current gate is in `(app)/layout.tsx`: `supabase.auth.getUser()`,
redirect to `/login` if no user; then it loads the user's
`instance_member` rows to populate the instance switcher (CLAUDE.md §13:
middleware only refreshes the session, it does not gate). The split
duplicates this gate shape into `(admin)/layout.tsx`.

**Who reaches `admin.grolabs.ai`:** the admin surface is the GroLabs-
internal management surface. Per Constitution Article 7 ("build models,
gate nothing in Phase 1"), the recommended Phase-1 behavior is to model
the distinction but keep enforcement light:

- **Authentication**: identical to RRE — both hosts require a logged-in
  Supabase user; unauthenticated → `/login`.
- **Authorization (modeled, not yet hard-enforced)**: admin.grolabs.ai
  is conceptually for GroLabs staff (members of the template tenant /
  instance 0, per `tenant-model.md` — GroLabs owns instance 0). The
  natural gate is "is this user a member of the GroLabs/template tenant?"
  Article 7 says we may pass this through to an admin-everywhere default
  in Phase 1 — i.e. any authenticated member can reach admin for now —
  while leaving a single, obvious `isGroLabsAdmin(user)` checkpoint in
  `(admin)/layout.tsx` to flip on when role taxonomy lands. This mirrors
  the existing deferred role gates flagged in CLAUDE.md §17 (funnel
  shared-write actions have "no app-level admin gate yet").
- **Entitlements**: no entitlement check is introduced (Article 7 — every
  entitlement check returns granted in Phase 1).

**Decided (2026-06-01):** Phase-1 admin access = **(a) any authenticated
user**. admin.grolabs.ai requires login (same as RRE); the
`isGroLabsAdmin(user)` checkpoint sits in `(admin)/layout.tsx`
default-granted, ready to flip on when role taxonomy lands. No hard
restriction in Phase 1.

> **Superseded by [`user-management.md`](user-management.md) §8 (PR 2).**
> That spec flips `isGroLabsAdmin(user)` to a **real** check — true only
> for active `tenant_member`s of the GroLabs template-owner tenant (owns
> instance 0) — so non-staff authenticated users get a sign-out screen
> (`NoAccess`) on the admin host. This **closes SEC-001**. The "any authenticated user"
> default above is the pre-flip state; once that PR lands, the admin host
> is GroLabs-staff-only. The flip is required there because the new admin
> **"Clientes"** surface (create customers, see cross-tenant data) cannot
> safely run under an open gate.

---

## 6. Migration plan (pure route-group reorganization, NO behavior change)

Each step is a file move or a thin refactor; none changes runtime
behavior on `app.grolabs.ai`. A future implementation session executes
this after ratification.

1. **Extract the Sidebar nav config** from `Sidebar.tsx` into a data
   module (e.g. `src/components/shell/nav.ts`) so the same `Sidebar`
   renders from a passed `nav` prop. Verify RRE looks identical.
2. **Create `src/app/[locale]/(admin)/layout.tsx`** — copy the
   `(app)/layout.tsx` auth gate + shell, swap in the admin nav config,
   add the `isGroLabsAdmin` checkpoint (default-granted per §5).
3. **Move the admin route folders** into `(admin)/`: `content/posts/**`
   and `prospects/**`. **Separately, move `styleguide/` *out* of `(app)`**
   to a public location (sibling of `legal/`, outside both groups) so it
   has no auth gate. Paths and imports are unchanged (`@/`-aliased); only
   the physical folders move.
4. **Update nav configs.** Remove Contenido, Prospectos, and the
   Sistema/Estilo style-guide link from the RRE nav. Contenido +
   Prospectos go into the admin nav; the admin nav also keeps the
   Sistema/Estilo link, now pointing at the public `/styleguide`. RRE
   ends up with no style-guide entry at all.
5. **Add host routing to `src/middleware.ts`** — read host
   (`host` / `x-forwarded-host`, port-stripped, as the blog helpers do),
   rewrite `admin.grolabs.ai` requests into the `(admin)` group, leave
   all other hosts in `(app)`. Keep the existing intl + Supabase steps
   unchanged and ordered first.
6. **Configure DNS + Vercel domains** — add `admin.grolabs.ai` and
   `app.grolabs.ai` to the same Vercel project pointing at one
   deployment. No second project. (Infra step, recorded here for the
   implementer.)
7. **Verify**: `npm run build` + `npm run typecheck` pass; on
   `app.grolabs.ai` the admin routes (`/content/posts`, `/prospects`)
   404 and no admin or style-guide links appear in the RRE nav; on
   `admin.grolabs.ai` only Blog + Prospectos render, with a working link
   out to `/styleguide`; `/styleguide` is publicly reachable (no login)
   on any host; public `/blog/[slug]` and `/diagnostics/[runId]` behave
   identically on both.

**Migrations / schema impact: none expected.** This is purely a route-
group + middleware reorganization. No table, column, RLS, or RPC change
is required — the admin host is an infrastructure allow-list constant,
not tenant data (unlike `instance.domain`, which already exists for the
blog and is untouched). Confirm during implementation that no moved page
hardcoded a URL that assumed its old group path (none observed — pages
use `@/i18n/routing` / `next/link` relative hrefs).

---

## 7. Constitutional compliance check

- **Article 2 — one core codebase, one schema, one deployable.**
  Satisfied. Both `app.grolabs.ai` and `admin.grolabs.ai` resolve to the
  **same** Next.js deployment; the split is route-group separation +
  host-based middleware routing **inside the single app**. No second
  Next.js app, no separate deployable, no `web-apps/admin` folder — the
  prior explicit product decision is honored.
- **Article 10 — repository is the source of truth; spec-driven /
  discussion-governed.** This document is a `Draft (awaiting approval)`
  proposal. No code or doc is changed by ratifying it; the §6 migration
  plan is executed only after explicit approval.
- **Article 7 — Phase 1 builds models without enforcement.** The
  admin-access distinction is modeled (`isGroLabsAdmin` checkpoint) but
  may default to granted in Phase 1; entitlements remain ungated.

No constitutional article is violated by this proposal.

---

## 8. Decisions & remaining defaults

**Resolved with the user (2026-06-01):**

1. **Single-app + host-routing — CONFIRMED.** Both hosts serve one
   deployable via middleware host-routing, per Article 2 and the prior
   "admin is a route group, not a separate app" decision. No separate
   app or deployable; no constitutional amendment needed.
2. **Phase-1 admin access gate — any authenticated user.**
   `admin.grolabs.ai` requires login (same as RRE) but is reachable by
   any authenticated user in Phase 1 (Article-7 model-only default). A
   single `isGroLabsAdmin(user)` checkpoint lives in
   `(admin)/layout.tsx`, default-granted, to flip on when role taxonomy
   lands.
3. **Style guide — public, admin-linked.** `/styleguide` moves *out* of
   the gated group to a public location (like `/legal/**`); anyone with
   the URL can view it (Tuncho may use it to reference other things). A
   link to it appears **only** in the admin nav — never in the RRE nav.

**Remaining minor defaults (these stand unless you say otherwise):**

- **Admin host locale handling.** `next-intl` `localePrefix: 'as-needed'`
  (default `es`, optional `/en`) applies app-wide; the admin host
  inherits the same i18n routing.
- **Admin host default landing route.** `/prospects` (vs `/content/posts`
  or a small admin home).
