---
application: core-app
module: Policy
title: "GroLabs Tenant Model — v1"
status: Draft
owner: "Tuncho"
scope: "Introduce a tenant layer above `instance`. A tenant owns one or more instances and carries the \"template vs. customer\" distinction at the ownership level instead of as a flag on each instance row."
audience: "Claude Code (primary), future GroLabs contributors"

actors:
  - name: Tenant
    type: system
    definition: The legal/organizational owner of one or more GroLabs instances. Carries a kind of template_owner or customer.
  - name: Instance
    type: system
    definition: Belongs to exactly one tenant via instance.tenant_id. A tenant can own many instances.
  - name: User
    type: human
    definition: Belongs to instances via instance_member.user_id, never to tenants directly.
  - name: service_role
    type: system
    definition: Privileged Postgres role; the only principal permitted to write tenant rows.

permissions:
  - actorId: User
    capability: select-tenant
    effect: conditional
    note: Allowed for an authenticated user who has at least one instance_member row pointing to an instance owned by that tenant.
  - actorId: service_role
    capability: write-tenant
    effect: allow
    note: INSERT / UPDATE / DELETE on tenant is service_role only. Customer signup will write tenants via a SECURITY DEFINER RPC.
  - actorId: User
    capability: write-tenant
    effect: deny
    note: Authenticated app role cannot insert/update/delete tenant rows directly.

integrations:
  - name: instance_member
    kind: internal-module
    target: instance
    direction: both
    purpose: Remains the security perimeter; membership (not tenant) gates cross-instance access, enforced by Postgres RLS keyed on instance_id.

rules:
  - id: R-1
    statement: An instance is a template iff its owning tenant has kind = 'template_owner'.
    truth: true
    rationale: Template ownership is a property of the owner, so it lives on the parent tenant, not as a per-instance flag.
  - id: R-2
    statement: tenant.kind is constrained to exactly two values, template_owner and customer, by a CHECK constraint.
    truth: true
  - id: R-3
    statement: An instance belongs to exactly one tenant via instance.tenant_id; after backfill instance.tenant_id is NOT NULL.
    truth: true
  - id: R-4
    statement: New code must not read instance.kind; it must join instance to tenant and read tenant.kind.
    truth: true
    rationale: instance.kind is deprecated and kept in sync only during the transition window.
  - id: R-5
    statement: Tenants are an organizational/ownership layer, not a security layer; the security perimeter stays instance_member plus RLS keyed on instance_id.
    truth: true
  - id: R-6
    statement: During deprecation an instance INSERT/UPDATE trigger keeps instance.kind in sync with the parent tenant's kind (template_owner→'template', customer→'customer').
    truth: true
  - id: R-7
    statement: A tenant's identity is its domain (Constitution Article 3). tenant.domain is a unique (case-insensitive, lowercased) column; customer tenants populate it and the same domain joins the existing tenant rather than duplicating it. tenant_id remains the physical surrogate PK; domain is the logical identity key.
    truth: true
    rationale: Added by user-management.md, which closes the unmodeled domain-identity decision flagged in docs/state/in-flight.md. The full create-customer / collaborator behavior lives in that doc.

useCases:
  - id: T-1
    title: Backfill yields two tenants and three reassigned instances
    given: The tenant migration has been applied
    when: The verification queries join instance to tenant
    then: Two tenant rows exist; three instance rows all have non-null tenant_id; instance 0 sits under GroLabs (template_owner) and instances 1 and 3 under Wazú (customer)
    verifies: [R-1, R-3]
---

# GroLabs Tenant Model — v1

This document is the authoritative spec for the tenant layer. Read it before writing any code that touches tenants, template ownership, or signup. Decisions here are locked — if implementation surfaces a flaw, raise it as a question instead of working around it silently.

## 1. What a tenant is

A **tenant** is the legal/organizational owner of one or more GroLabs instances.

- A user belongs to **instances**, not tenants. Membership is `instance_member.user_id → instance_id` — unchanged by this work.
- An instance belongs to exactly one tenant via `instance.tenant_id`.
- A tenant can own many instances (Wazú will eventually have a production instance, a staging instance, and short-lived test instances — all under one Wazú tenant).
- A tenant carries a `kind`: either `template_owner` or `customer`.
- A tenant is **identified by its `domain`** (Constitution Article 3) — see §10.

Tenants are an **organizational/ownership** layer, not a security layer. The security perimeter remains `instance_member` and Postgres RLS keyed on `instance_id`. Cross-instance access is still gated by membership, never by tenant.

(There is no separate `docs/policy/multi-tenancy.md` today. The multi-tenancy rules in `CLAUDE.md` §2 — `instance_id` everywhere, `instance_member` is the security perimeter, RLS reads `instance_id` from the JWT — are unchanged.)

## 2. Why we have tenants now

Three problems converge on the same answer:

1. **Template ownership is a property of an owner, not a flag on a row.** Today `instance.kind = 'template'` says "this instance is a GroLabs-owned blueprint." That collapses two concepts: (a) who owns it (GroLabs), and (b) how it should be used (as a template). When we add more template instances — e.g. a vertical-specific template — they all share owner=GroLabs. That belongs on a parent record.

2. **Signup needs an owner record before it has an instance.** The new-instance flow from `instance-management.md` creates an instance per user action. With tenants, signup becomes "create a customer tenant + first instance under it" atomically. Future invites land users into the existing tenant's instance, not into a free-floating row.

3. **Multi-template, multi-instance per customer.** Once tenants exist, Wazú can own a production instance and a sandbox instance under one billing/ownership umbrella. GroLabs can own multiple template instances (general retail, pet vertical, …).

The minimum viable shape is: one new table, one FK column, two seeded tenant rows, backfill of three existing instances.

## 3. Tenant kinds

Exactly two values, enforced by a CHECK constraint on `tenant.kind`:

| kind             | Meaning                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `template_owner` | Tenant owns template instances. Today: GroLabs.                                                  |
| `customer`       | Tenant owns customer-facing instances (real catalogs, real shoppers). Today: Wazú.               |

**Rule:** an instance is a template iff its owning tenant has `kind = 'template_owner'`.

There is no per-instance "is this a template" flag in the target state. The legacy `instance.kind` column is being deprecated (see §5) but kept in place during the transition.

## 4. Backfill — initial tenant data

Two tenant rows are seeded by this migration:

| name    | slug    | kind             |
| ------- | ------- | ---------------- |
| GroLabs | grolabs | template_owner   |
| Wazú    | wazu    | customer         |

Existing instances are reassigned as follows:

| instance_id | name                          | old `kind` | → tenant slug |
| ----------- | ----------------------------- | ---------- | ------------- |
| 0           | GRO RRE Template (System)   | template   | grolabs       |
| 1           | Wazu                          | customer   | wazu          |
| 3           | Test Wazú                     | customer   | wazu          |

After backfill, `instance.tenant_id` is set NOT NULL.

## 5. Deprecation of `instance.kind`

`instance.kind` is **deprecated, not dropped**, in this migration.

- A column comment marks it deprecated and tells future readers to use `instance.tenant_id → tenant.kind` instead.
- Existing application code still reads `instance.kind` in a few places (sidebar template badge, admin filters). Those readers will be migrated in a follow-up PR.
- During the deprecation window, an `instance` INSERT/UPDATE trigger keeps `instance.kind` in sync with the parent tenant's `kind`:
  - tenant.kind = `template_owner` → instance.kind = `'template'`
  - tenant.kind = `customer`       → instance.kind = `'customer'`
- Once all readers move to the tenant join, a follow-up migration drops `instance.kind` and the sync trigger together.

**Rule for new code:** do not read `instance.kind`. Join `instance → tenant` and read `tenant.kind`. New writers do not need to set `instance.kind` — the trigger handles it.

## 6. Future: signup creates tenant + instance atomically

Out of scope for this migration, but the shape it enables:

- `createInstance(name)` becomes `createTenantAndInstance(tenant_name, instance_name)` for new signups.
- Both rows are inserted in one transaction; the `instance_member` row for the creator is inserted in the same transaction with `role='owner'` and `is_current=true` (per `instance-management.md`).
- Invitations to existing tenants (later policy doc) attach a new `instance_member` to an existing instance — the tenant doesn't change.

This PR does not ship that flow. It only makes the data shape that supports it possible.

## 7. RLS on the new `tenant` table

Conservative defaults:

- **SELECT:** allowed for any authenticated user who has at least one `instance_member` row pointing to an instance owned by that tenant. Users see the tenants they actually belong to via membership.
- **INSERT / UPDATE / DELETE:** service_role only.

Tenant rows are low-cardinality and rarely written. The customer-facing signup flow (when it lands) will go through a `SECURITY DEFINER` RPC, so tenant writes from app code via the normal authenticated role stay blocked. This is intentionally tight — loosen later when there's a concrete need.

## 8. Out of scope for this migration

- Tenant-level billing (`tenant.billing_config`, plan, etc.) — `instance` keeps its current billing fields; tenant-level rollup is a later policy doc.
- Tenant-level branding (logo, color) — out of scope.
- Multi-instance topbar switching across instances of the same tenant — that lives in `instance-management.md` and is keyed on memberships, not tenants.
- Dropping `instance.kind` — explicit follow-up migration once readers are migrated.
- Tightening RLS to role-gated writes — covered when the broader role taxonomy lands.

## 9. Verification checklist (post-migration)

These three queries must all return consistent data before the migration is considered applied:

```sql
SELECT * FROM tenant ORDER BY tenant_id;

SELECT instance_id, name, kind, tenant_id
FROM instance
ORDER BY instance_id;

SELECT t.name AS tenant_name, t.kind AS tenant_kind,
       i.name AS instance_name, i.kind AS instance_kind
FROM instance i
JOIN tenant t ON i.tenant_id = t.tenant_id
ORDER BY t.tenant_id, i.instance_id;
```

Expected: two tenant rows; three instance rows all with non-null `tenant_id`; the join shows instance 0 under GroLabs (template/template_owner) and instances 1, 3 under Wazú (customer/customer).

## 10. Tenant domain — the identity key (added by `user-management.md`)

Constitution **Article 3** mandates that *"tenant identity is keyed by domain; email is unique per user, not per tenant."* The original tenant layer (this doc's v1) shipped keyed on `slug` with **no `domain` column** — an unmodeled constitutional requirement flagged in Review 1 and tracked as an open architectural decision in `docs/state/in-flight.md`.

[`user-management.md`](user-management.md) closes that gap by adding:

```sql
alter table public.tenant
  add column domain text;            -- lowercased; unique index, case-insensitive
create unique index uq_tenant_domain on public.tenant (lower(domain));
```

Decisions (locked there, summarized here):

- **`domain` is the logical identity key; `tenant_id` stays the physical PK.** `instance.tenant_id` and `tenant_member.tenant_id` already FK to the bigserial `tenant_id`. We honor "keyed by domain" via a unique constraint rather than a destructive PK/FK rewrite. Making `domain` the literal PK is a separate, larger migration if ever wanted.
- **`customer` tenants must have a domain.** The create-customer action requires it. The `template_owner` tenant (GroLabs) gets `grolabs.ai`. The column is added nullable for backfill safety, then required at the application layer for customers.
- **Resolve-or-create by domain.** Creating a customer looks up the tenant by `lower(domain)`; if it exists, **reuse** it (Article 3 T-3 — same domain joins the existing tenant); else insert a new `customer` tenant. This is the Article-3 anti-duplication rule.
- **Email-per-user / collaborator seam.** Because email is globally unique, provisioning a user whose email already exists **attaches** a new `tenant_member` to that existing identity instead of creating a duplicate auth user. The full create/attach logic lives in `user-management.md` §2.3.

The tenant **branding** layer (logo, colors, fonts) remains out of scope here (§8) — `domain` is identity, not branding.
