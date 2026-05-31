# GroLabs Admin

Multi-tenant catalog management admin for GroLabs (a GRO Labs product).
Dedicated GroLabs admin, shares visual language with GroLabs (D22).

## What's built (Phase 1.0 slice)

- **Next.js 15** App Router + TypeScript + Supabase SSR
- **Auth**: Supabase email + password. Session cookies refreshed by middleware on every request. Google login / magic link deferred (trivial to add later).
- **App shell**: sidebar + topbar, GroLabs's IA (Catálogo / Referencias / Configuración), Spanish copy throughout.
- **Products list** (`/catalog/products`): real Supabase data, filter chips (all / active / inactive / consignment / service) with live counts, click-through to editor, empty state.
- **Product editor** (`/catalog/products/[id]`): read-only two-column layout mirroring GroLabs's design, exercising the full GroLabs schema — product info, brand, primary category, attribute values, variants with SKU/barcode/weight/pricing, import-ID backlink when `wazudb1_id` is set.
- **Design system**: the GroLabs tokens + components ported verbatim, prefix renamed `bl-` → `s-` and `bloom-` → `rre-`. See `src/app/globals.css`.

## What's NOT built yet (deliberately)

Each of these is a clean follow-up slice:

- Product editor **write path** (edit + save). Currently every input is `disabled` and shows DB data read-only.
- Categories screen (tree view)
- Attributes screen (split view)
- Matching rules screen
- Species / breeds reference screens
- Command palette (⌘K)
- Assistant side panel (GroLabs's inline AI)
- Image library / upload
- Dashboard
- Service editor, pack builder (specialized flows per product_type)
- Sign-up flow (users are provisioned out-of-band for now)

## Prerequisites

- Node.js 20+
- A Supabase project with the GroLabs schema applied (project `ixbbhwtpnebrhquunege`)
- A user in `auth.users` with a `tenant_member` row — `tuncho@wazu.test` already exists

## Run it locally

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
# Edit .env.local and paste:
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  (from Supabase → Settings → API → Project API keys → anon public)
#   SUPABASE_SERVICE_ROLE_KEY      (from the same page → service_role — SECRET)

# 3. Set a password for the test user
# In the Supabase dashboard:
#   Authentication → Users → tuncho@wazu.test → ... → "Send recovery"
# or use the SQL editor to set a password directly.

# 4. Run
npm run dev
# App runs on http://localhost:3030
```

Sign in with `tuncho@wazu.test` and the password you set. You should land on the products list showing the 6 Wazu synthetic products.

## Architecture

### Routing
- `/login` — public
- `/catalog/products` — lists products
- `/catalog/products/[id]` — product editor
- Everything else: sidebar shows dimmed "coming soon" rows

### Auth flow
1. Unauthenticated user visits `/catalog/products`
2. `(app)/layout.tsx` checks `supabase.auth.getUser()` → redirects to `/login`
3. Login page server-actions into `supabase.auth.signInWithPassword()` → redirects back
4. Middleware (`src/middleware.ts`) refreshes the session cookies on every subsequent request

### Data flow
Every data fetch uses the `server` Supabase client (`src/lib/supabase/server.ts`), which reads the session cookie and makes queries under the authenticated user's JWT. **RLS does the tenant isolation automatically** — application code never writes `WHERE tenant_id = X`; the policies do it.

For admin-only flows (signup's `copy_template_to_tenant`, imports, reconciliation), there's a `service-role` client (`src/lib/supabase/service-role.ts`) that bypasses RLS. Not used this pass.

## Project structure

```
src/
├── app/
│   ├── globals.css              ← design system (ported from GroLabs)
│   ├── layout.tsx               ← root layout
│   ├── page.tsx                 ← redirects → /catalog/products
│   ├── login/page.tsx           ← public login
│   └── (app)/                   ← protected route group (auth-gated)
│       ├── layout.tsx           ← sidebar + topbar + auth gate
│       └── catalog/
│           ├── page.tsx         ← redirects → /catalog/products
│           └── products/
│               ├── page.tsx     ← list
│               └── [id]/page.tsx ← editor
├── components/
│   └── shell/
│       ├── Sidebar.tsx          ← nav with GroLabs IA
│       └── TopBar.tsx           ← search placeholder + user menu
├── lib/
│   ├── format.ts                ← formatGTQ, formatRelative, initials
│   └── supabase/
│       ├── client.ts            ← browser client
│       ├── server.ts            ← server client (RLS-scoped)
│       └── service-role.ts      ← service-role client (bypasses RLS)
└── middleware.ts                ← refreshes auth cookies per request
```

## Design fidelity

The `s-*` classes in `globals.css` are 1:1 ports of the GroLabs `bl-*` design tokens and components. If you want to look at GroLabs for reference, the token values and component shapes are identical — only the prefix changed. This is what lets GroLabs share visual language without sharing code.

## Next suggested session

- Wire up the product editor to actually save. Server action → Supabase update → `revalidatePath`. ~30 min.
- Build Categories screen (tree picker). ~1 session.
- Build Attributes split-view. ~1 session.
