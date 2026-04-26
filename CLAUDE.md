# Scout — Claude Code conventions

## Repository layout

```
scout/
├── supabase/          ← database migrations and schema (PostgreSQL / Supabase)
├── downloads/         ← Next.js admin app (scout-admin)
└── docs/              ← decision log, design prompts, entity inventory
```

The Next.js application lives in `downloads/`. All front-end work happens there.

---

## i18n architecture

### Locked decisions

| Decision | Value | Rationale |
|---|---|---|
| Default locale | `es` | Spanish is the product language. Wazu and all Phase 1 tenants are Spanish-speaking. |
| Supported locales | `['es', 'en']` | English is planned (GroLabs multi-tenant roadmap) but not active until messages are complete and UI is validated. |
| URL strategy | `localePrefix: 'as-needed'` | Spanish gets clean URLs (`/catalog/products`). English gets a prefix (`/en/catalog/products`). |
| Canonical path language | English ASCII | Route segments are always English: `catalog`, `products`, `settings`. Never `/catalogo`, `/productos`. |
| Message source of truth | `messages/es.json` | TypeScript types in `global.d.ts` are derived from this file. `en.json` must mirror the same key structure. |

### File map

```
downloads/
├── messages/
│   ├── es.json          ← primary translations (Spanish)
│   └── en.json          ← English translations (stub — populate per screen)
├── src/
│   ├── i18n/
│   │   ├── routing.ts   ← defineRouting + createNavigation exports
│   │   └── request.ts   ← getRequestConfig (server-side message loading)
│   ├── app/
│   │   ├── layout.tsx   ← minimal root layout (html/body in [locale]/layout.tsx)
│   │   └── [locale]/    ← all routes live here
│   └── middleware.ts    ← next-intl + Supabase session, chained
└── global.d.ts          ← IntlMessages type (derived from es.json)
```

### Navigation utilities

`src/i18n/routing.ts` exports locale-aware `Link`, `redirect`, `usePathname`, and `useRouter`. **New screens must import these instead of the next/navigation equivalents** so that links carry the active locale automatically.

Existing screens still use `next/navigation` directly; they work correctly for `es` (the default locale, no prefix). Migrate on a screen-by-screen basis as screens are built or rewritten.

```ts
// ✅ New screens
import { Link, redirect } from '@/i18n/routing';

// ⚠️ Legacy (works for 'es' only, migrate when touching the file)
import Link from 'next/link';
import { redirect } from 'next/navigation';
```

---

## Hardcoded user-facing strings — FORBIDDEN

**Do not write user-visible strings as JSX literals or template strings in components.**

Every user-facing string must come from the message files via `useTranslations` (client components) or `getTranslations` (server components / server actions).

```tsx
// ❌ Forbidden
<h1>Catálogo</h1>
<button>Guardar</button>
const label = "Configuración";

// ✅ Correct
const t = useTranslations('nav');
<h1>{t('catalog')}</h1>

// ✅ Correct (server component)
const t = await getTranslations('settings.algolia');
<h1>{t('title')}</h1>
```

**Exceptions** (these do not need i18n):
- `console.log` / error messages for developers
- Data values coming from the database (product names, slugs, etc.)
- CSS class names, `aria-label` derived from data, icon `title` attributes containing dev notes
- The `placeholder` attribute on disabled/visual-only inputs (Phase 1 pattern)

There is no ESLint plugin enforcing this automatically. Code review is the gate. When reviewing a PR that adds a new screen, scan for JSX string literals outside of the above exceptions.

---

## Multi-tenancy conventions

- Never write `WHERE tenant_id = X` in application code. RLS policies handle tenant isolation automatically via the JWT claim.
- The `service-role` Supabase client (bypasses RLS) is only for admin flows: copy-on-signup, imports, reconciliation. Never use it for normal data reads.

---

## Auth conventions

- Unauthenticated access is blocked in `src/app/[locale]/(app)/layout.tsx`, not in middleware.
- Middleware's only job is session-cookie refresh (Supabase) + locale routing (next-intl).
- `redirect('/login')` and `redirect('/catalog/products')` in server actions use plain `next/navigation` for now; migrate to `@/i18n/routing` when the write paths are built out.
