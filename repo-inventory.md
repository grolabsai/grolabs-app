# Scout repo inventory

_Generated 2026-04-25_

---

## Stack

- **Framework**: Next.js `^15.1.0` (App Router, TypeScript, `typedRoutes: true`)
- **React**: `^19.0.0` / `react-dom ^19.0.0`
- **Supabase**: `@supabase/ssr ^0.5.2`, `@supabase/supabase-js ^2.45.0`
- **i18n**: `next-intl ^4.9.1`
- **TypeScript**: `^5.6.0`
- **Dev port**: 3030
- No Tailwind. No shadcn. Design system is hand-written CSS in `src/app/globals.css`.

---

## shadcn Config

No `components.json` found. shadcn is not installed.

---

## Design Tokens

File: `downloads/src/app/globals.css`. Custom CSS-var system, prefix `--s-*` / `--scout-*`, ported verbatim from a sibling app called Bloom (prefix renamed `bl-` → `s-`). No `.dark` block exists.

```css
:root {
  --scout-accent: #378ADD;
  --scout-accent-hover: #185FA5;
  --scout-accent-50: #E6F1FB;
  --scout-accent-100: #B5D4F4;
  --scout-accent-600: #185FA5;
  --scout-accent-800: #0C447C;
  --s-bg: #FAFAF9;
  --s-surface: #FFFFFF;
  --s-surface-alt: #F5F5F4;
  --s-surface-hover: #EFEFEE;
  --s-border: rgba(0, 0, 0, 0.08);
  --s-border-strong: rgba(0, 0, 0, 0.16);
  --s-text: #1A1A1A;
  --s-text-secondary: #5F5E5A;
  --s-text-tertiary: #888780;
  --s-text-muted: #B4B2A9;
  --s-success: #1D9E75;
  --s-success-bg: #E1F5EE;
  --s-success-text: #085041;
  --s-danger: #A32D2D;
  --s-danger-bg: #FCEBEB;
  --s-danger-text: #501313;
  --s-radius-sm: 6px;
  --s-radius-md: 8px;
  --s-radius-lg: 12px;
  --s-radius-xl: 16px;
  --s-font: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  --s-font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
}
```

No `.dark` block.

---

## Tailwind Theme

No `tailwind.config.ts` or `tailwind.config.js` found.

---

## Components Installed

No `components/ui/` directory. The only components directory is `src/components/shell/`:

- `Sidebar.tsx`
- `TopBar.tsx`

---

## Setup & Scripts

**Scripts** (from `downloads/package.json`):

| Script | Command |
|--------|---------|
| `dev` | `next dev --port 3030` |
| `build` | `next build` |
| `start` | `next start --port 3030` |
| `lint` | `next lint` |
| `typecheck` | `tsc --noEmit` |

**Local setup** (from `downloads/README.md`):

```bash
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
npm run dev
# App at http://localhost:3030
```

Test user: `tuncho@wazu.test` — password must be set via Supabase dashboard or SQL editor before first login.

**Supabase backend setup** (from repo root `README.md`):

```bash
supabase login
supabase link --project-ref ixbbhwtpnebrhquunege
supabase db pull       # pull schema from cloud
# or
supabase start         # run local instance
supabase db push       # apply migrations
supabase migration new <name>
```

---

## Environment Variables

From `downloads/scout-admin/.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

(`NEXT_PUBLIC_SUPABASE_URL` has the project URL pre-filled in the example file; the other two require manual entry.)

---

## Conventions

- **Multi-tenant isolation**: `tenant_id` column on all data tables + Postgres RLS. Application code never writes `WHERE tenant_id = X`; policies handle it automatically.
- **Two Supabase clients**: `server.ts` (RLS-scoped, uses session JWT) and `service-role.ts` (bypasses RLS — server-only, for admin flows).
- **Auth**: Supabase email/password. Middleware refreshes session cookies on every request; auth enforcement lives in `src/app/[locale]/(app)/layout.tsx`.
- **i18n**: `defaultLocale: 'es'`, `localePrefix: 'as-needed'`. Spanish URLs have no prefix; English gets `/en/`. Canonical route segments are English-ASCII. Message source of truth is `messages/es.json`. New screens must import `Link`/`redirect` from `@/i18n/routing`, not `next/navigation`.
- **Design system**: `s-*` CSS classes, 1:1 port of Bloom's `bl-*` tokens. Token values are identical; only the prefix changed.
- **Translation tables, not JSONB**: every translatable entity has a companion translation table. BCP 47 locale codes (`es-GT`, `en-US`).
- **Templates as SQL**: new tenant onboarding uses SQL seed scripts committed to the repo.
- **Language**: UI copy is in Spanish. Hardcoded user-visible strings in components are forbidden — all strings go through `useTranslations` / `getTranslations`.
- **Phase 1 read-only editor**: all product editor inputs are `disabled`; write path is a deliberate follow-up slice.
