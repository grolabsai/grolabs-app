---
application: core-app
module: Security
title: "Audit — server-action authorization (cluster 2)"
status: "Findings — 0 critical, 0 medium, 1 low + 2 observations"
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Cluster 2 of the M1 security audit. Every Next.js server action (35 'use server' files, ~180 exported actions) and whether each authorizes the caller for the instance/resource it touches. Executed 2026-08-02 against main @ c616c18 (static read; no live invocation)."
---

# Audit — server-action authorization

**Scope:** all 35 `"use server"` files and their ~180 exported actions. Each was
checked for the one question that matters: before it reads or mutates, does it
verify the caller is authorized for the specific instance/resource involved?

**Verdict:** **strong. No critical or medium findings.** The codebase applies
four consistent authorization patterns and applies them nearly everywhere. One
low finding (internal admin tooling lacks action-level gating, bounded by
self-scoping) and two low/info observations.

This cluster found **no new cross-tenant exposure.** The one cross-tenant write
issue in the server-action layer — `funnel.ts` shared-table writes — was already
reported in cluster 1 (Finding 2) and is not repeated here.

---

## The four authorization patterns (all correct)

Every well-formed action uses one of these. During the audit, "is this action
safe?" reduced to "which of these four is it using, and correctly?"

1. **RLS client + session-derived instance.** `createClient()` (runs under the
   user's JWT) + `currentInstanceId()` (resolves the caller's *own* instance
   from their membership). The instance is never taken from request input, and
   RLS is the backstop. Used by the bulk of catalog/blog/pricing actions
   (`pricing.ts` 36 actions, `product.ts`, `category.ts`, `variant.ts`,
   `categoryAttribute.ts`, `post.ts`, `import.ts`, …). Verified: `createClient`
   and `currentInstanceId` call-counts track the action count in every one of
   these files.

2. **Explicit membership check on a parameter-supplied instance.** When an
   action legitimately takes `instanceId` as an argument, it first confirms the
   caller is an active member. `search/actions.ts` (`authorizeMembership()`
   helper, or inline check in `saveStorefrontDomains` / `initializeIndex`) and
   `search-analytics.ts` (`authorize(instanceId)` on all 7 actions) do this
   correctly.

3. **SECURITY DEFINER RPC that checks `instance_member`.** Where an action must
   touch Vault or bypass RLS, it calls an RPC that re-checks membership and
   `RAISE EXCEPTION 'not_member'` otherwise. Verified in the SQL for all three
   Algolia RPCs (`20260426000001`) and all three WooCommerce RPCs
   (`20260507000001`), including the two that return decrypted secrets
   (`algolia_get_admin_key`, `woocommerce_get_consumer_secret`). CLAUDE.md §7's
   claim that these "check `instance_member` before acting" holds.

4. **Admin / role gate.** `is_grolabs_admin()` for GroLabs-staff-only operations
   and `isCurrentTenantAdmin()` for tenant-admin operations. `users.ts`
   (cluster 1) and `instance.ts` use these.

### Spot-verified highlights

- **`switchToInstance` (`instance.ts`)** — the app-side of the escalation pivot
  the isolation audit attacked from the DB. Correctly gated: membership checked
  via the RLS client against the caller's own rows; a non-member is rejected
  `not_a_member` unless `is_grolabs_admin()` is true (the documented cross-tenant
  staff switcher). Both sides of the pivot — DB RLS and this action — hold.
- **`listConfigSources` (`instance.ts`)** — uses service-role but filters
  strictly to the caller's own membership ids. No enumeration of other tenants.
- **`saveAlgoliaConfig` / `saveWooCommerceConfig`** — take `instanceId` from
  input, but every downstream RPC re-checks membership, so a forged instance id
  is rejected server-side.

---

## FINDING 4 — LOW: the (admin) prospects server actions have no action-level authorization

**Status:** open · **Severity:** low (bounded by self-scoping) · **Defense-in-depth**

The `(admin)` route group (`admin.grolabs.ai` — the internal prospectos tooling)
has **24 server actions** across 6 files:

```
prospects/_actions.ts                     (2)   prospects/rubric/actions.ts             (6)
prospects/benchmarks/actions.ts           (3)   prospects/rubric/vocabulary/actions.ts  (6)
prospects/[prospectId]/_actions.ts        (4)   prospects/[prospectId]/vocabulary/…     (3)
```

**None of them call `isGroLabsAdmin()`.** Authorization for the admin surface
lives only in `(admin)/layout.tsx`, which enforces `isGroLabsAdmin()` — but a
layout gates **page rendering**, not server actions. In Next.js a server action
is an independently addressable POST endpoint; a non-admin authenticated user
who has the action reference (from network capture, a shared build, or the app
bundle) can invoke these directly, bypassing the layout entirely.

### Why it is low, not high

Every one of these actions is **self-scoped**: it resolves the target instance
via `currentInstanceId()` (the caller's own) and either uses the RLS client or
adds `.eq("instance_id", <own>)`. So a non-admin who invokes them directly can
only affect **their own instance's** prospectos data — which, for a normal
customer, is otherwise unused. It is not a cross-tenant read or write.

Concretely, a curious HPC user could: create/edit `diagnostic_check`,
`fix_recommendation`, benchmark, or vocabulary rows **on instance 11**; and
trigger `rescanProspectPage` / `rescanAllProspectPages` (URL fetches — see the
cluster-3 note below). None of it touches instance 0 (the template the public
diagnostic actually reads) or any other tenant.

### Why it still matters

- **Internal tooling should not be reachable by customers at all**, even against
  their own data. The layout gate creates a false sense that it isn't.
- **It is one refactor away from becoming serious.** The moment any of these
  actions is changed to take an `instanceId` parameter, or to write instance-0 /
  shared rubric data (which is the whole point of the template rubric), the
  self-scoping protection disappears and this becomes a cross-tenant or
  shared-data write with no gate. The `funnel.ts` finding is exactly this class,
  already realized.

### Fix

Add an `isGroLabsAdmin()` check at the top of each of the 24 actions (or a shared
`assertGroLabsAdmin()` guard the way `funnel.ts` should get one). Small,
mechanical, and it makes the authorization independent of the layout.

---

## Observations (low / informational — not filed as defects)

**O-1 — `blog-ai.ts` actions are authentication-only.** All 5 AI actions call a
`gate()` that requires a logged-in user with an instance, but not a specific
role. Any authenticated user can invoke them and spend Anthropic API credits.
Same shape as the funnel finding, but the resource at risk is **API cost**, not
shared data — so it is much lower severity. Worth a rate-limit or a per-instance
budget before opening the app to less-trusted users. Not an M1 blocker with a
single trusted customer.

**O-2 — `listTemplateSources` (`instance.ts`) exposes template metadata to any
authenticated user.** It enumerates `template_owner` tenants' instances and their
category/attribute counts via service-role, deliberately broader than RLS. The
data is the shared blueprint every new tenant is seeded from — low sensitivity —
but it is authentication-gated rather than admin-gated. Acceptable; noted for
completeness.

---

## Handoff to cluster 3 (public surface)

Two things surfaced here belong to the public-surface cluster and are logged so
they are not lost:

- **`startDiagnostic` / `rescanProspectPage` / `rescanAllProspectPages` fetch
  attacker-influenced URLs server-side** (the prospectos scan engine). Combined
  with the missing action gate (Finding 4) and the **public anonymous**
  diagnostic API (`/api/v1/diagnostic/runs`), this is a potential SSRF /
  resource-abuse surface that cluster 3 must examine: what URLs can be reached,
  is there an internal-address blocklist, and what are the rate limits.
- The **public diagnostic API's** own `instance_id = NULL` model and rate limiter
  (`record_diagnostic_request`) are cluster-3 scope.

---

## What this cluster did NOT cover

- **Live invocation.** This was a static read of every action. Findings 1 and the
  cluster-1 items were confirmed live; Finding 4's direct-invocation path was
  reasoned from Next.js semantics + the absence of a gate, not exploited.
- **Input validation depth.** Auth was the lens here. Whether each action
  validates its *payload* (types, ranges, injection) is cluster 4.
- **CSRF.** Next.js server actions have built-in origin checks; not separately
  tested here.

---

## Recommendation

Nothing in this cluster blocks M1 with a single trusted customer. Before adding
any less-trusted user, or before touching the prospectos admin actions:

1. Add `isGroLabsAdmin()` to the 24 `(admin)` actions (Finding 4) — cheap, and it
   removes the "one refactor from serious" risk.
2. Rate-limit or budget `blog-ai.ts` (O-1) if the app opens to less-trusted users.
3. Carry the SSRF/rate-limit questions into cluster 3.
