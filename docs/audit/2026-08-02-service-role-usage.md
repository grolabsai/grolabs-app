---
application: core-app
module: Security
title: "Audit — service-role usage & privileged-endpoint authorization (cluster 1)"
status: "Findings — 0 critical, 2 medium, 1 low"
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Cluster 1 of the M1 security audit. Every call site of the service-role Supabase client (which bypasses RLS) and the authorization on every route/action that uses it. Executed 2026-08-02 against main @ c616c18 and, where noted, the live production deployment app.grolabs.ai."
---

# Audit — service-role usage & privileged-endpoint authorization

**Scope:** the 47 files that construct a service-role client or read
`SUPABASE_SERVICE_ROLE_KEY`. The service-role client bypasses RLS entirely, so
each call site is only as safe as the authorization check in front of it — RLS
(proven sound in the tenant-isolation audit) does nothing here.

**Verdict:** **no critical findings. The privileged surface is, on the whole,
carefully built** — instance is resolved from the session (not the request) on
every dashboard/debug endpoint, `users.ts` re-checks admin on every entry point,
and the write-key path is textbook. Two medium findings and one low, all
pre-existing and two of them already acknowledged in the code or CLAUDE.md §17.

Method note: two findings were confirmed **live against production** with
`curl`, targeting only instances I own (99999 the test fixture, and my own
data). No customer data was touched; the one probe row written was deleted and
its deletion verified.

---

## What is built correctly (the majority)

**The client itself** (`src/lib/supabase/service-role.ts`) throws if the key is
missing, disables session persistence, and carries a clear "never return to the
browser without tenant-scoping" contract.

**Dashboard / debug / log endpoints** — `cart-debug`, `events-log`,
`searches-log`, `dashboard/carts`, `ga4/realtime` — all follow the same safe
shape: resolve the caller's instance from **their session**
(`instance_member WHERE is_current`), then scope every service-role query with
`.eq("instance_id", instanceId)`. The request never chooses the instance. The
endpoint names ("debug") are misleading — these are correctly authorized.

**User administration** (`src/lib/actions/users.ts`) — every one of the ~8
mutating entry points re-checks authorization before doing anything:
`createCustomerAccount` / `listTenantsForAdmin` gate on
`is_grolabs_admin() === true`; `createTenantUser` / `setTenantUserRole` /
`deactivateTenantUser` / `listTenantMembers` gate on a tenant-admin check
(`isCurrentTenantAdmin`, backed by the `is_tenant_admin` SQL helper). This is
the SEC-001 fix working as intended and is the model the rest of the codebase
should follow.

**Write-key path** (`src/lib/byo/write-key.ts`, `byo/auth.ts`) — keys are
stored only as SHA-256 hashes, verified with `crypto.timingSafeEqual` against
the presented key's hash, scoped to the instance. Plaintext shown once at
issuance. No notes.

**GA4 / cron endpoints** — `ga4/poll` and `blog/publish-due` require
`Authorization: Bearer ${CRON_SECRET}`; the OAuth `callback` scopes its
membership lookup to the instance carried in the signed `state` nonce. Sound.

**Input hygiene on the public endpoints** — strict `Number.isInteger` /
`>= 0` validation with **no falsy-coercion of instance 0** (the CLAUDE.md §2
trap is correctly avoided), length caps on every string field, exact-match host
comparison. Good defensive code.

---

## FINDING 1 — MEDIUM: Origin is treated as an authorization boundary on the public storefront endpoints

**Status:** open (documented design) · **Confirmed live on production 2026-08-02**

`/api/v1/events`, `/api/v1/orders`, `/api/v1/search`, `/api/v1/search/token`
and `/api/v1/events/token` share one trust model, stated verbatim in the code:

> *"instance_id is public (Stripe-publishable-key class). Origin header is
> validated against instance.storefront_domains. No auth header from the
> storefront; the storefront IS the authorized caller iff its origin is
> whitelisted."*

The flaw is in the last clause. **The `Origin` header is only trustworthy when
a browser sets it.** A non-browser client (curl, a script, a server) sends any
`Origin` value it likes. So the real guarantee is not "the storefront is the
caller" — it is "anyone who knows the storefront's domain is the caller," and a
storefront domain is public information.

### Proven live

Against `https://app.grolabs.ai`, from curl (no browser), targeting instance
99999 whose whitelist includes `localhost`:

```
POST /api/v1/events        Origin: http://localhost   → 200 {"ok":true}
POST /api/v1/search/token  Origin: http://localhost   → 200 {"token":"eyJ…","index_uid":"inst_99999"}
```

Controls behaved correctly — a non-whitelisted Origin and a missing Origin both
returned `403`:

```
POST /api/v1/events  Origin: https://attacker.example → 403
POST /api/v1/events  (no Origin header)               → 403
```

The event **landed in the database** (verified via service-role read, then
deleted): a fabricated `conversion` worth `1234.56` attributed to instance
99999. The minted search token was a valid Meilisearch JWT filtered to
`instance_id = 99999`.

### Impact

For any instance whose storefront domain an attacker knows:

- **Integrity (events/orders):** inject fabricated `conversion` / `view` /
  `cart_remove` / order events. This poisons the merchant's dashboards, revenue
  KPIs, and — because these events feed the search relevance loop — the search
  ranking itself. Bounded to that instance (the endpoints correctly pin
  `instance_id`); it is not a cross-tenant DB breach.
- **Confidentiality (search token):** mint a working search token and read the
  instance's Meilisearch index directly. For a public storefront the catalog is
  largely public already, but the index may carry fields the storefront doesn't
  render (internal attributes, unpublished items).

**Not currently exploitable against HPC** — HPC's `storefront_domains` is empty,
so no Origin matches it (the same gap flagged in the isolation audit). Instances
16 and 99999 are targetable today. **HPC becomes targetable the moment it
registers a domain to go live** — which is exactly the go-live step.

### Why this is medium, not critical

It is the documented, deliberate trust model, it does not cross tenant
boundaries, and the confidentiality half is low for public catalogs. But
"anyone who knows a public domain can write to your analytics and read your
index" is more exposure than the "Stripe-publishable-key" framing implies —
Stripe publishable keys can't write charges.

### Options (not applied — report-only)

There is no perfect fix that keeps the zero-config storefront model, so this is
a decision, not a one-liner:

1. **Accept + document** the risk explicitly for M1, and lean on Finding 3
   (rate-limit the ingest) to bound abuse volume. Cheapest.
2. **Shared secret per instance** issued at storefront-plugin install, sent as a
   header alongside the public `instance_id`. Turns "knows the domain" into
   "holds the secret." The write-key pattern already exists to copy.
3. **HMAC-sign events** in the plugin with a per-instance key. Strongest,
   most work.

Recommend deciding between (1) and (2) before HPC registers a domain.

---

## FINDING 2 — MEDIUM: funnel shared-table writes are gated by authentication only, not authorization

**Status:** open · Already flagged in code comments and CLAUDE.md §17

`src/lib/actions/funnel.ts` exposes 12 mutating server actions. Six of them
write to **globally shared** tables — `funnel_flow`, `funnel_stage`,
`funnel_transition` (all confirmed to have **no `instance_id` column** — they
are one shared model for the whole platform). The guard on every one is:

```ts
async function assertAuthenticated() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthenticated" };
  return null;   // ← any logged-in user passes
}
```

RLS on those tables allows only `service_role`, so the action opens a
service-role client to do the write — meaning the RLS restriction is bypassed
and the **only** thing standing between any authenticated user and the global
funnel model is "are you logged in." The file's own header says so:

> *"App-level admin gating is NOT yet wired up — any authenticated user … the
> role-gating follow-up."*

### Impact

Any authenticated user — including a beta client's staff (HPC has two accounts)
— can create, update, or delete funnel stages and transitions that are shared
across **all** tenants. A curious or malicious client user could corrupt the
funnel definitions every other tenant sees. No cross-tenant data *read*, but a
cross-tenant integrity/availability problem.

The `createFunnelStage` / `updateFunnelStage` actions also accept a raw
`funnel_flow_id` / `funnel_stage_id` with no ownership check at all.

### Fix

Wire these six shared-table actions to `is_grolabs_admin()` — the exact check
`users.ts` already uses. The per-tenant funnel actions (those touching
`instance_id`-scoped tables) can stay on member-level auth. This is the
role-gating the code comments already promise; it's small and the helper exists.

---

## FINDING 3 — LOW: event/order ingest has no rate limiting

**Status:** open

`/api/v1/search/token` and `/api/v1/events/token` both rate-limit (per-IP and
per-(instance,origin), via `checkRateLimit`). The raw ingest endpoints
`/api/v1/events` and `/api/v1/orders` do **not** — there is no rate-limit call
in either handler.

Combined with Finding 1, a caller who forges a whitelisted Origin can write
`analytics_event` / `sales_order` rows in an unbounded loop: storage cost,
Postgres load on the metric-rollup path, and dashboard/relevance poisoning at
volume rather than one row at a time.

**Fix:** apply the same `checkRateLimit` the token endpoints use, keyed on
(instance, IP). Low severity on its own; it is the natural mitigation lever for
Finding 1 if you choose option 1 there.

---

## What this cluster did NOT cover

- **Per-tenant funnel actions and other member-level server actions** beyond confirming the shared-table ones — a full server-action authorization sweep is cluster 2.
- **The public anonymous diagnostic API** (`/api/v1/diagnostic/runs`) — its own rate-limiter and `instance_id = NULL` model belong to the public-surface cluster (cluster 3).
- **Secret handling and PII in logs** — cluster 4. (Noted in passing: several handlers `console.error` raw Supabase error messages, which can carry row detail; worth a look in cluster 4.)
- **Whether any service-role result is returned to the browser unscoped** — spot-checked clean on the endpoints read here, not exhaustively traced through every helper in `src/lib/`.

---

## Recommendation

Nothing here blocks M1 by itself, but two items should be decided **before HPC
registers a storefront domain**, because that action arms Finding 1 against a
real customer:

1. Decide Finding 1's posture (accept+document, or add a per-instance secret).
2. Add rate limiting to the ingest endpoints (Finding 3) — cheap, and it bounds Finding 1 either way.
3. Gate the funnel shared-table actions (Finding 2) before any beta client has an account that can reach `/funnel`.
