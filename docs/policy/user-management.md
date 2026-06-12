---
application: core-app
module: Policy
title: "GroLabs User & Account Management — v1"
status: Draft
owner: "Tuncho"
scope: "Admin-provisioned accounts. GroLabs staff create a customer (tenant + domain + first instance + first Tenant Admin) from the admin surface; that Tenant Admin then creates more Admins and Members for their own tenant from the RRE app. Adds Google + Microsoft SSO (GroLabs-styled, pre-created emails only), a forced first-login password change, a real GroLabs-admin gate (closes SEC-001), and a GroLabs-staff cross-tenant instance switcher. No public self-signup."
audience: "Claude Code (primary), future GroLabs contributors touching auth, the login page, src/lib/auth/admin.ts, src/lib/actions/instance.ts, the (admin) and (app) layouts, or the instance switcher."

actors:
  - name: GroLabs staff
    type: human
    definition: A member of the GroLabs template-owner tenant (owns instance 0). The only principal who can create customers and who sees every tenant's instances in the switcher. Authorization is enforced by isGroLabsAdmin() (this doc flips it from the SEC-001 stub to a real check).
  - name: Tenant Admin
    type: human
    definition: A user with tenant_member.role in (owner, admin) for their tenant. Can create and manage Admins and Members for that tenant and its instances. The first user GroLabs staff create for a new customer is a Tenant Admin.
  - name: Member
    type: human
    definition: A user with tenant_member.role = member. Uses the app on the tenant's instances; cannot manage users. Granted instance_member rows for all of the tenant's instances.
  - name: createCustomerAccount
    type: system
    definition: Admin-surface server action (service-role) that atomically resolves-or-creates a tenant by domain, creates the first instance, creates-or-attaches the first user as Tenant Admin, and mints a one-time password.
  - name: createTenantUser
    type: system
    definition: RRE-app server action (service-role, re-checks is_tenant_admin) that creates-or-attaches a user to the caller's tenant with role admin or member and grants instance_member rows for the tenant's instances.
  - name: SSO provider
    type: system
    definition: Supabase OAuth providers google and azure (Microsoft Entra ID / Exchange-hosted domains). Surfaced as two GroLabs-styled buttons on the shared /login page. Sign-in succeeds only for already-provisioned emails.
  - name: service_role
    type: system
    definition: Privileged Supabase client. The only principal permitted to create auth users (auth.admin.createUser) and write tenant / tenant_member / instance / instance_member rows in these flows.

users:
  - name: GroLabs staff
    description: Creates customers and crosses tenants; member of the template-owner tenant (instance 0).
  - name: Tenant Admin
    description: Manages users within their own tenant; first user of every new customer.
  - name: Member
    description: Baseline app user; no user-management powers.

permissions:
  - actorId: GroLabs staff
    capability: create-customer
    effect: allow
    note: Create tenant + domain + first instance + first Tenant Admin from the admin surface. Gated by isGroLabsAdmin().
  - actorId: GroLabs staff
    capability: switch-cross-tenant
    effect: allow
    note: See and switch into any tenant's instance; the switcher lists all instances as "domain — instance" for staff only.
  - actorId: Tenant Admin
    capability: create-tenant-user
    effect: allow
    note: Create Admins/Members for their own tenant; server action re-checks is_tenant_admin for the caller's current tenant.
  - actorId: Tenant Admin
    capability: create-customer
    effect: deny
    note: Cannot create new tenants or cross tenants; that is GroLabs-staff only.
  - actorId: Member
    capability: create-tenant-user
    effect: deny
    note: Members hold no user-management powers.
  - actorId: SSO provider
    capability: provision-on-signin
    effect: deny
    note: SSO never auto-provisions. A sign-in whose email has no existing user/tenant_member is rejected; accounts are created only by the two admin actions.

integrations:
  - name: tenant.domain
    kind: internal-module
    target: tenant
    direction: in
    purpose: New column. The tenant's identity key per Constitution Article 3 ("tenant identity is keyed by domain"). Resolve-or-create on customer creation; same domain joins the existing tenant.
  - name: isGroLabsAdmin
    kind: internal-module
    target: rls
    direction: out
    purpose: Flipped from the SEC-001 default-granted stub to a real check (membership in the template-owner tenant). Gates the admin surface and the cross-tenant switcher.
  - name: instance_member
    kind: internal-module
    target: instance
    direction: both
    purpose: Operational access. Members/Admins get a row per tenant instance; GroLabs staff get an ensured row on cross-tenant switch so current_instance_id() and RLS keep working unchanged.
  - name: tenant_member
    kind: internal-module
    target: tenant
    direction: both
    purpose: Organizational role (admin | member) — the source of truth for who can manage users. The BEFORE-INSERT trigger from tenant-membership.md still requires a tenant_member before any instance_member.
  - name: Supabase Auth (Google)
    kind: external-service
    target: Google OAuth
    direction: in
    purpose: provider 'google'. Manual setup — Google Cloud OAuth client + enable provider in Supabase.
  - name: Supabase Auth (Microsoft)
    kind: external-service
    target: Microsoft Entra ID
    direction: in
    purpose: provider 'azure'. Covers domains hosted on Microsoft 365 / Exchange Online. Manual setup — Entra app registration + enable provider in Supabase.

rules:
  - id: R-1
    statement: There is no public self-signup. Accounts are created only by GroLabs staff (createCustomerAccount) or a Tenant Admin (createTenantUser). The login page offers password + SSO sign-in, never registration.
    truth: true
  - id: R-2
    statement: A tenant's identity is its domain (Constitution Article 3). tenant.domain is unique (case-insensitive, lowercased). Creating a customer resolves-or-creates by domain — the same domain joins the existing tenant rather than duplicating it.
    truth: true
    rationale: Article 3 R-3 and T-3 ("same domain joins existing tenant"). This closes the unmodeled-domain-identity open decision in docs/state/in-flight.md.
  - id: R-3
    statement: A user's email is globally unique (Article 3 — "email is unique per user, not per tenant"). If the email already has an auth user, the create actions ATTACH a new tenant_member/instance_member to that existing user (collaborator) instead of creating a duplicate auth user.
    truth: true
  - id: R-4
    statement: Two tenant roles are operational in v1 — admin (manage users + the tenant's instances) and member (baseline). They map onto tenant_member.role; owner is treated as admin-with-full-control. billing is reserved, not surfaced in v1.
    truth: true
  - id: R-5
    statement: A Member is granted instance_member rows for ALL of the tenant's instances (tenant-wide access), not a hand-picked subset, in v1.
    truth: true
  - id: R-6
    statement: Creating a customer is one atomic flow producing four rows — tenant (kind=customer, domain), instance, the auth user, tenant_member(role=admin) — plus an instance_member(is_active, is_current). The tenant_member is written before the instance_member (tenant-membership.md trigger contract).
    truth: true
  - id: R-7
    statement: New password accounts carry user_metadata.must_change_password=true. Both (app) and (admin) layouts redirect such users to /cambiar-contrasena until the flag clears. SSO users never carry the flag.
    truth: true
  - id: R-8
    statement: isGroLabsAdmin() is a real check — true iff the user is an active tenant_member of the template-owner tenant (the tenant whose kind='template_owner', which owns instance 0). This replaces the SEC-001 default-granted stub and gates both the admin surface and the cross-tenant switcher.
    truth: true
    rationale: Closes backlog SEC-001 / CLAUDE.md §17 admin-gate item.
  - id: R-9
    statement: SSO is sign-in only, never provisioning. A Before-User-Created auth hook rejects any OAuth identity whose email has no already-provisioned user; a belt-and-suspenders layout gate signs out and shows "no access" for an authenticated user with zero active instance_member rows.
    truth: true
  - id: R-10
    statement: The Google and Microsoft buttons use GroLabs --gl-* tokens (canvas surface, our border, our text), not vendor brand colors or the official vendor buttons. Each carries only a small monochrome provider glyph (inline svg, explicit width/height, currentColor) for recognition.
    truth: true
    rationale: Tuncho's direction. Note: a monochrome Google mark deviates from Google's brand guidelines; accepted deliberately.
  - id: R-11
    statement: For GroLabs staff, the instance switcher lists every instance joined to its tenant and displays "tenant.domain — instance.name", grouped by domain. For non-staff the switcher is unchanged (own active memberships only).
    truth: true
  - id: R-12
    statement: When a GroLabs staff member switches into an instance they are not a member of, switchToInstance upserts an instance_member row for them (is_active, is_current) so current_instance_id() and all existing RLS continue to work unchanged. Non-staff keep the strict membership validation.
    truth: true
  - id: R-13
    statement: must_change_password lives in Supabase user_metadata, not a new column. No schema change beyond tenant.domain is required by this feature.
    truth: true
  - id: R-14
    statement: Enabling the Google and Microsoft providers (Google Cloud OAuth client, Entra app registration, Supabase provider toggles, redirect URIs) is a manual infrastructure step performed in the respective consoles, not code. It is a prerequisite for the SSO buttons to function.
    truth: unverified

useCases:
  - id: T-1
    title: GroLabs staff create a customer
    given: A GroLabs staff member on the admin "Clientes" screen
    when: They submit domain, tenant name, first instance name, and an admin email, then generate a password
    then: A customer tenant (domain), a first instance, an auth user with must_change_password, a tenant_member(admin), and an instance_member(is_current) are created; the password is shown once
    verifies: [R-2, R-6, R-7]
  - id: T-2
    title: Same domain joins the existing tenant
    given: A tenant already exists for domain acme.com
    when: GroLabs staff create another account for acme.com
    then: The existing tenant is reused (no duplicate); the new user/instance attach under it
    verifies: [R-2]
  - id: T-3
    title: Tenant Admin adds a Member
    given: A Tenant Admin on the RRE "Equipo" screen
    when: They create a user with role Member
    then: The user gets tenant_member(member) and instance_member rows for every instance of the tenant, with a one-time password
    verifies: [R-4, R-5]
  - id: T-4
    title: SSO rejects an unknown email
    given: A Gmail user who was never provisioned
    when: They click "Iniciar sesión con Google"
    then: The Before-User-Created hook rejects the sign-in; no auth user is created
    verifies: [R-9]
  - id: T-5
    title: Forced first-login password change
    given: A freshly created password account with must_change_password=true
    when: The user logs in
    then: Both surfaces redirect to /cambiar-contrasena until they set a new password, after which the flag clears
    verifies: [R-7]
  - id: T-6
    title: GroLabs staff cross-tenant switch
    given: A GroLabs staff member
    when: They open the instance switcher
    then: Every tenant's instances are listed as "domain — instance"; switching into a non-member instance ensures their instance_member row so the app scopes correctly
    verifies: [R-11, R-12]
  - id: T-7
    title: Non-staff cannot reach the admin surface
    given: An authenticated user who is not a member of the template-owner tenant
    when: They request an admin.grolabs.ai route
    then: isGroLabsAdmin() returns false and the (admin) layout renders a sign-out screen (NoAccess) so the user can switch accounts
    verifies: [R-8]
---

# GroLabs User & Account Management — v1

This document is the authoritative spec for how GroLabs accounts are created and managed. Read it before writing any code that touches authentication, the login page, `src/lib/auth/admin.ts`, the user/instance creation actions, or the instance switcher. Decisions here are locked — if implementation surfaces a flaw, raise it as a question rather than working around it silently.

It builds directly on three existing policies and one constitutional article:

- **`tenant-model.md`** — what a tenant is (now: identified by `domain`, Article 3).
- **`tenant-membership.md`** — the two membership layers and the `admin | member` roles.
- **`instance-management.md`** — the switcher and `switchToInstance` / `createInstance` actions.
- **Constitution Article 3** — tenant identity is keyed by **domain**; **email is unique per user**; cross-tenant access is a **collaborator** model, not tenant-merging.

## 1. Goals and non-goals

### Goals
1. **GroLabs staff provision customers.** From the admin surface (`admin.grolabs.ai`), a staff member creates a customer in one form: company **domain**, tenant name, first **instance**, and the first user — born as a **Tenant Admin** — with a generated **one-time password**.
2. **Tenant Admins provision their own team.** Inside the RRE app, a Tenant Admin creates more **Admins** and **Members** for their tenant.
3. **SSO sign-in** with **Google** and **Microsoft** on both hosts, styled in GroLabs tokens, restricted to already-provisioned emails.
4. **Forced first-login password change** for generated passwords.
5. **GroLabs staff see every tenant's instances** in the switcher, shown as `domain — instance`.
6. **Close SEC-001** — the admin gate becomes a real check.

### Non-goals (deferred)
- **Public self-signup / plugin-driven onboarding handshake** (Article 3's grolabs.ai handshake) — separate future flow.
- **Self-serve collaborator model** (a user requesting/accepting cross-tenant access) — only GroLabs staff cross tenants in v1; the general collaborator model is future (Article 3, Module 2 "collaborator management").
- **`billing` role surfacing** and the full **instance-level role taxonomy** (`viewer/editor/supervisor/admin`) — reserved; see `tenant-membership.md` §2 and `module-map.md` Module 1.
- **Per-instance member scoping** — v1 grants Members all of a tenant's instances (R-5).
- **Password reset / forgot-password email flow** — Module 16 owns this; not built here beyond the forced-change screen.

## 2. Data model

Only **one** schema change: `tenant.domain`. Everything else reuses existing tables.

### 2.1 `tenant.domain` (new — the identity key)

Per Constitution Article 3, a tenant's identity **is** its domain. Add:

```
tenant.domain  text  UNIQUE  (lowercased, case-insensitive)
```

- **Surrogate PK stays.** `tenant.tenant_id` (bigserial) remains the physical PK because `instance.tenant_id` and `tenant_member.tenant_id` FK to it. `domain` is the **logical identity key** (Article 3) enforced by a unique index — we honor "keyed by domain" without a destructive PK/FK rewrite. (If a future migration wants domain as the literal PK, that is a separate, larger change.)
- **Nullability.** `customer` tenants must have a domain (the create action requires it). The `template_owner` tenant (GroLabs) gets `grolabs.ai`. The column is added nullable for backfill safety, then customer rows are required to populate it at the application layer.
- **Resolve-or-create.** Creating a customer looks up `tenant` by `lower(domain)`; if found, **reuse** it (Article 3 T-3 — same domain joins the existing tenant); else insert a new `customer` tenant.

This **closes the "Domain-as-tenant-identity" open architectural decision** in `docs/state/in-flight.md` and the Review-1 gap that `tenant`/`tenant_member` were keyed on slug with no domain column.

### 2.2 Roles (reuse `tenant_member.role`)

`tenant_member.role` is already `CHECK in (owner, admin, billing, member)`. v1 surfaces two:

| UI label      | `tenant_member.role` | Powers |
| ------------- | -------------------- | ------ |
| Administrador | `admin` (or `owner`) | Manage users (create/role/deactivate) + the tenant's instances. |
| Miembro       | `member`             | Use the app on the tenant's instances. No user management. |

`owner` (the very first user, set by backfill / first-create) is treated as a full-control Admin. `billing` is **reserved**, not shown in v1.

A SQL helper `is_tenant_admin(p_tenant_id)` (SECURITY DEFINER) returns true when the current auth user is an active `tenant_member` of that tenant with role in `(owner, admin)`. Every user-management server action re-checks it.

### 2.3 Email identity & the collaborator seam (Article 3)

Email is **globally unique per user**. Both create actions therefore:

1. Look up an existing `auth.users` row by email.
2. **If present** → do **not** create a new auth user; attach a fresh `tenant_member` (+ `instance_member`) to the existing user. This is the Article-3 **collaborator** primitive (one identity, membership in multiple tenants).
3. **If absent** → `supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { must_change_password: true } })`, then attach memberships.

### 2.4 `must_change_password`

Stored in `user_metadata` (no column). Set on generated-password creation; cleared after the user changes it. SSO logins never set it.

## 3. Surface 1 — Admin "Clientes" (GroLabs staff)

New `(admin)` route group screen (e.g. `src/app/[locale]/(admin)/clientes/`), in the admin nav (`buildAdminNav` / `nav.ts`), gated by `isGroLabsAdmin()`.

- **List:** existing tenants — `domain`, name, instance count, member count.
- **New customer form** (all fields via `t()`, §3 form conventions — `HintedInput`/`HintedSelect`, label inside the border, hints in the agent panel):
  - Company **domain** (required, lowercased on save)
  - Tenant **name**
  - First **instance name**
  - First user **email** (becomes Tenant Admin)
  - **"Generar contraseña"** button → strong random password shown once with a copy button.
- **Action `createCustomerAccount(...)`** (service-role, gated by `isGroLabsAdmin()`):
  1. Resolve-or-create `tenant` by `lower(domain)` (`kind='customer'`).
  2. Insert `instance` (`tenant_id`, name, derived slug via `deriveSlug` from `instance.ts`).
  3. Resolve-or-create the auth user by email (§2.3); set `must_change_password` when newly created.
  4. Insert `tenant_member(role='admin', is_active)` **first**.
  5. Insert `instance_member(is_active, is_current)`.
  6. Return the one-time password (only when newly created).

### 3.1 Detail — per-tenant user management

Each tenant row in the list links to `/clientes/[tenantId]`
(`(admin)/clientes/[tenantId]/`), where GroLabs staff manage that tenant's
existing users. Loaded by `getTenantDetailForAdmin(tenantId)`; every mutation is
re-gated by `is_grolabs_admin()` **and** re-verifies that `(tenantId, userId)` is
a real `tenant_member` (so an operator can only touch users of the tenant they
opened). These are the staff-side, tenant-parameterized analogues of the §4
Tenant-Admin actions:

- `adminUpdateUserName(tenantId, userId, fullName)` — sets
  `user_metadata.full_name` + `name` (merge-preserves the rest of the metadata).
- `adminResetUserPassword(tenantId, userId)` — sets a fresh strong password +
  `must_change_password=true`, returns the one-time password to show once.
  Disabled in the UI for SSO accounts (`app_metadata.provider !== 'email'`),
  which have no password.
- `adminSetTenantUserRole(tenantId, userId, role)` — `admin | member`, cascaded
  to the tenant's `instance_member` rows.
- `adminSetTenantUserActive(tenantId, userId, active)` — toggles
  `tenant_member.is_active` + the tenant's `instance_member` rows (clears
  `is_current` on deactivate).

Email change is intentionally **out of scope** here — email is the Article-3
identity key; changing it is a separate, higher-risk flow.

## 4. Surface 2 — RRE "Equipo" (Tenant Admin)

New `(app)` screen under `/configuration` (e.g. `/configuration/equipo`), in `buildRreNav` under Configuración, **visible only to Tenant Admins** (`is_tenant_admin` for the current instance's tenant).

- **List:** the tenant's members — email, role, active.
- **New user form:** email, role select (**Administrador | Miembro**), "Generar contraseña" one-time password.
- **Actions** (service-role, each re-checks `is_tenant_admin` for the caller's current tenant server-side):
  - `createTenantUser(email, role)` — resolve-or-create user (§2.3); insert `tenant_member(role)`; insert `instance_member` for **all** of the tenant's instances (R-5).
  - `setTenantUserRole(userId, role)` — change role.
  - `deactivateTenantUser(userId)` — set `tenant_member.is_active=false` (and instance memberships inactive).

## 5. Surface 3 — SSO (Google + Microsoft, both hosts)

Two buttons on the shared `src/app/[locale]/login/page.tsx`:

- **"Iniciar sesión con Google"** → `signInWithOAuth({ provider: 'google' })`
- **"Iniciar sesión con Microsoft"** → `signInWithOAuth({ provider: 'azure' })` — covers Microsoft 365 / Exchange-hosted domains.

Both `redirectTo` a new `/auth/callback` route that exchanges the code for a session, then routes to the locale root. All strings via `t()`.

**Layout (login page):** SSO is the **primary** path and leads the card (Google
then Microsoft), with an "or with email" divider beneath it; email + password is
the **secondary** fallback below the divider. Its submit button (`LoginForm`,
client) stays muted (`s-btn-secondary`) until a password is typed, then turns
yellow (`s-btn-primary`) — so the email form doesn't pull focus from SSO until
the user commits to it. All login strings live under the `auth.login` namespace.

### 5.1 Styling (R-10)
Both buttons use the **GroLabs design system**, not vendor branding:
- shadcn `Button` (outline/ghost), `--gl-surface` canvas + our border + our text tokens; **no** vendor brand colors, **no** official Google/Microsoft button.
- A small **monochrome** provider glyph (inline `<svg>`, explicit `width`/`height` per §3, `currentColor`) purely for recognition. Both glyphs fill their box to the same optical weight (the Google mark's `viewBox` is tightened to its content bounds so it isn't visually smaller than Microsoft's).
- (Accepted deviation: a monochrome Google mark is off Google's brand guidelines.)

### 5.2 Access — pre-created emails only (R-9)
- **Before-User-Created auth hook** (Postgres function) rejects any OAuth identity whose email has no already-provisioned user.
- **Layout gate (belt-and-suspenders):** in both `(app)` and `(admin)` layouts, an authenticated user with **zero** active `instance_member` rows is signed out and shown a "sin acceso" state.

### 5.3 Manual setup (R-14 — prerequisite, not code)
Document the exact steps in the implementing PR:
- **Google:** Supabase → enable Google provider; Google Cloud Console OAuth client (client ID/secret); authorized redirect URIs for `app.grolabs.ai`, `admin.grolabs.ai`, and localhost + the Supabase callback URL.
- **Microsoft:** Supabase → enable Azure provider; Microsoft Entra ID app registration (Application (client) ID + secret; supported-account-types = any org directory + personal MS accounts unless restricting to one Entra tenant); add the Supabase callback URL as a redirect URI.

## 6. Surface 4 — Forced first-login password change

New `/cambiar-contrasena` screen. In both `(app)` and `(admin)` layouts, after the auth check: if `user.user_metadata.must_change_password === true`, redirect there (allow only that route + `/login` + `/auth/**` until cleared). The screen calls `auth.updateUser({ password })`, then `auth.updateUser({ data: { must_change_password: false } })`, then routes to the locale root. SSO users are unaffected (no flag). Strings via `t()`, §3 form conventions, password-strength validation.

## 7. Surface 5 — GroLabs-staff cross-tenant switcher

Extends `instance-management.md`:
- In the `(app)`/`(admin)` layout data fetch + `InstanceSwitcher.tsx`: if `isGroLabsAdmin()`, list **all** instances joined to `tenant`, displayed as **`tenant.domain — instance.name`**, grouped/sorted by domain; otherwise unchanged (own active memberships).
- `switchToInstance()` (in `instance.ts`): when a GroLabs staff member switches into a non-member instance, **upsert** an `instance_member` row for them (`is_active`, `is_current`) so `current_instance_id()` + RLS keep working unchanged (R-12). Non-staff keep strict membership validation.
- All display strings come from DB values (domain, instance name) — no hardcoding.

## 8. The admin gate flip (closes SEC-001)

`src/lib/auth/admin.ts` `isGroLabsAdmin(user)` changes from the always-true Phase-1 stub to: **true iff the user is an active `tenant_member` of the `template_owner` tenant** (the tenant that owns instance 0). A SQL mirror `is_grolabs_admin()` (SECURITY DEFINER) backs RLS/RPC reuse. The `(admin)` layout awaits it and renders a sign-out screen (`NoAccess`) for non-staff — not `notFound()`, which would trap them with no way to log out. This resolves **SEC-001** (`backlog-registry.md` §4 / `CLAUDE.md` §17 / `rre-admin-split.md` §5, §8).

## 9. Constitutional compliance

- **Article 3 (domain identity, email-per-user, collaborator model).** Directly implemented: `tenant.domain` is the identity key (resolve-or-create by domain); email is globally unique (resolve-or-attach existing user); GroLabs-staff cross-tenant access is a constrained first slice of the collaborator model. **No silent registration** — accounts exist only by explicit admin action.
- **Article 7 (build models, gate later).** This deliberately *adds* enforcement (the real `isGroLabsAdmin`, `is_tenant_admin`) because it is now the bottleneck for safely creating customers and exposing cross-tenant data. The funnel/other deferred gates in `CLAUDE.md` §17 are unaffected.
- **Article 2 (one deployable).** No new app; admin and RRE remain route groups in the single Next.js deployable (`rre-admin-split.md`). The SSO buttons live on the shared `/login`.
- **Article 10 (repo is source of truth).** This doc plus the synchronized docs in §11 are the source of truth; code implements them.

## 10. Implementation sequence (7 PRs)

1. **Schema** — `tenant.domain` (unique, lowercased) + `is_tenant_admin()` helper; backfill GroLabs→`grolabs.ai`. Update `schema.md`.
2. **Admin gate** — real `isGroLabsAdmin()` + `is_grolabs_admin()`; `(admin)` layout renders a sign-out screen (`NoAccess`) for non-staff. Closes SEC-001.
3. **SSO** — Google + Microsoft buttons (GroLabs-styled), `/auth/callback`, Before-User-Created hook + layout no-access gate. (+ manual provider setup.)
4. **Admin "Clientes"** — list + create-customer form + `createCustomerAccount`.
5. **RRE "Equipo"** — list + create/role/deactivate + `createTenantUser`, gated by `is_tenant_admin`.
6. **Forced password change** — `/cambiar-contrasena` + layout redirect on `must_change_password`.
7. **Cross-tenant switcher** — staff see all instances as `domain — instance`; `switchToInstance` ensures staff membership.

PRs 1–2 are foundational and land first; 3–7 can parallelize after.

## 11. Documents kept in sync with this spec

Per the "docs travel with code" rule, this feature updates:
- `docs/policy/tenant-model.md` — adds `tenant.domain` (Article 3 identity).
- `docs/policy/tenant-membership.md` — points its "admin tooling" / cross-user-listing notes here.
- `docs/policy/instance-management.md` — adds the GroLabs-staff cross-tenant switcher + SSO login.
- `docs/policy/rre-admin-split.md` — the gate flip + the new admin "Clientes" section + SSO on `/login`.
- `docs/policy/backlog-registry.md` — SEC-001 resolution pointer.
- `docs/policy/README.md` + `CLAUDE.md` §18 — policy index entry.
- `CLAUDE.md` §17 — SEC-001 marked resolved by this doc.
- `docs/state/in-flight.md` — closes the domain-as-tenant-identity open decision.
- `docs/state/schema.md` — `tenant.domain` (planned).
- `docs/state/modules.md` — the two new screens + SSO (planned).
- `docs/module-map.md` — Module 2 / Module 16 pointers.
- `docs/glossary.md` — SSO + tenant-domain terms.

## 12. Out of scope (future policies)

- `account-onboarding.md` — public, plugin-driven signup + the grolabs.ai handshake (Article 3).
- `collaborators.md` — self-serve cross-tenant collaborator grants/accepts (Article 3, Module 2).
- `instance-roles.md` — the full instance-level role taxonomy (`viewer/editor/supervisor/admin`).
- Password reset / forgot-password email flow (Module 16).
- Per-instance Member scoping and `billing`-role surfacing.

## 13. Verification checklist (post-implementation)

1. `tenant.domain` exists, unique; GroLabs tenant = `grolabs.ai`; a customer create resolves-or-creates by domain (no duplicate on repeat domain).
2. `isGroLabsAdmin()` returns false for a non-template-tenant user → `admin.grolabs.ai` renders a sign-out screen (`NoAccess`); true for staff.
3. Creating a customer yields tenant+instance+auth user+tenant_member(admin)+instance_member(is_current); one-time password shown once; `must_change_password` set.
4. A Tenant Admin can create a Member who lands with `instance_member` rows for every tenant instance; cannot cross tenants; a Member sees no "Equipo" screen.
5. Google + Microsoft buttons render in GroLabs tokens (no vendor colors); an unknown email is rejected by the hook; an orphan authenticated user is signed out.
6. Forced password change blocks the app until completed; SSO users skip it.
7. A staff member sees all instances as `domain — instance` and can switch into a Wazú instance; a non-staff user sees only their own.
8. `npm run build` + `npm run typecheck` pass; migration applied + verified per `CLAUDE.md` §12.
