---
application: core-app
module: Policy
title: "GroLabs Tenant Membership — v1"
status: Draft
owner: "Tuncho"
scope: "Introduce `tenant_member` — a user's direct membership in a tenant, parallel to `instance_member` but one layer up. Defines the two-layer membership model, role taxonomy, backfill rule, and the trigger contract that keeps the layers consistent."
audience: "Claude Code (primary), future GroLabs contributors"

actors:
  - name: tenant_member
    type: system
    definition: A user's direct membership in a tenant — answers "which tenants does this user belong to?" Used for billing, tenant admin, signup, home-tenant lookup, invitations.
  - name: instance_member
    type: system
    definition: A user's access to a specific instance/catalog — answers "which catalogs can this user access?" Drives RLS data isolation and the instance switcher.
  - name: User
    type: human
    definition: A person who may belong to tenants (organizational) and instances (operational).
  - name: service_role
    type: system
    definition: Privileged Postgres role; the only principal permitted to write tenant_member rows.
  - name: Enforcement trigger
    type: system
    definition: trg_enforce_tenant_member_before_instance_member — BEFORE INSERT on instance_member, raises if no active matching tenant_member exists.

users:
  - name: owner
    description: Tenant role with full control, including deleting the tenant and removing other owners.
  - name: admin
    description: Tenant role that manages instances and tenant members but cannot delete the tenant itself.
  - name: billing
    description: Tenant role limited to billing settings and history; no instance or member management.
  - name: member
    description: Baseline tenant role; belongs to the tenant and can be granted instance memberships, no admin powers.

permissions:
  - actorId: owner
    capability: delete-tenant
    effect: allow
  - actorId: admin
    capability: delete-tenant
    effect: deny
    note: Admin manages instances and members but cannot delete the tenant.
  - actorId: billing
    capability: manage-billing
    effect: allow
    note: Billing settings and history only; no instance or member management.
  - actorId: member
    capability: tenant-admin
    effect: deny
    note: Baseline role; can be granted instance memberships but holds no admin powers.
  - actorId: User
    capability: select-tenant-member
    effect: conditional
    note: A user may read only their own tenant_member rows (user_id = auth.uid()).
  - actorId: service_role
    capability: write-tenant-member
    effect: allow
    note: INSERT/UPDATE/DELETE on tenant_member is service_role only; writes flow through SECURITY DEFINER RPCs.

integrations:
  - name: instance_member
    kind: internal-module
    target: instance
    direction: both
    purpose: Operational membership layer; RLS is keyed on instance_id, never tenant_id. The enforcement trigger ties each instance_member to a tenant_member.
  - name: tenant
    kind: internal-module
    target: tenant_member
    direction: in
    purpose: Parent record; ON DELETE CASCADE on the tenant_id FK cleans up tenant_member rows when a tenant is deleted.

rules:
  - id: R-1
    statement: For every instance_member row there must exist a corresponding tenant_member row matching (instance.tenant_id, user_id) with is_active = true.
    truth: true
    rationale: Tenant membership is organizational and must exist before instance (operational) access; the trigger enforces this precondition.
  - id: R-2
    statement: A tenant_member row with no instance_member rows is valid; the reverse is required but not the forward — tenant access can exist without instance access.
    truth: true
    rationale: Covers sales-ops, billing contacts, and invited-but-not-yet-provisioned users.
  - id: R-3
    statement: tenant_member.role is CHECK-constrained to one of owner, admin, billing, member, with column default 'member'.
    truth: true
  - id: R-4
    statement: instance_member.role is unchanged in this PR — free-text, default 'owner', no CHECK constraint.
    truth: true
    rationale: The instance role taxonomy and its CHECK constraint are deferred to a future PR.
  - id: R-5
    statement: The enforcement trigger is BEFORE INSERT only (not UPDATE) and raises rather than silently auto-creating a tenant_member.
    truth: true
    rationale: Loud failure surfaces callers operating on the wrong tenant; silent auto-create would hide those bugs.
  - id: R-6
    statement: Application code owns ordering — insert the tenant_member row first, then the instance_member row.
    truth: true
  - id: R-7
    statement: tenant_member SELECT is restricted to a user's own rows; INSERT/UPDATE/DELETE is service_role only. Cross-user listing is not exposed via RLS in v1.
    truth: true
  - id: R-8
    statement: Backfill creates one tenant_member (role owner, is_active true) per distinct (user_id, tenant_id) from instance_member joined to instance, using ON CONFLICT DO NOTHING so it is re-runnable.
    truth: true

useCases:
  - id: T-1
    title: Backfill produces three tenant_member rows
    given: The migration has been applied against production data (verified 2026-05-14)
    when: Querying tenant_member joined to tenant
    then: Three rows exist — one owner under GroLabs (tenant 1) and two owners under Wazú (tenant 2)
    verifies: [R-8]
  - id: T-2
    title: Invariant holds with no orphan instance_member rows
    given: The migration and backfill are complete
    when: Left-joining instance_member to tenant_member on (tenant_id, user_id)
    then: Zero rows lack a matching tenant_member
    verifies: [R-1]
  - id: T-3
    title: Inserting an instance_member without a tenant_member is rejected
    given: No active tenant_member exists for the target user and tenant
    when: An instance_member INSERT is attempted
    then: The enforcement trigger raises and names the user and tenant
    verifies: [R-1, R-5]
---

# GroLabs Tenant Membership — v1

This document is the authoritative spec for tenant-level membership. Read it before writing any code that touches `tenant_member`, signup flows, invitations, tenant admin, or billing access. Decisions here are locked — if implementation surfaces a flaw, raise it as a question instead of working around it silently.

The prior policy `docs/policy/tenant-model.md` defines what a tenant *is*. This document defines who *belongs* to one.

## 1. The two membership layers and why both exist

GroLabs has two membership tables, each answering a different question:

| Table             | Question it answers                                  | Used for                                                                          |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tenant_member`   | "Which tenants does this user belong to?"            | Billing, tenant admin, signup, "home tenant" lookup, future invitations.          |
| `instance_member` | "Which catalogs/instances can this user access?"     | RLS data isolation, per-catalog roles, the instance switcher (`is_current`).      |

The two layers are **not redundant**. They model different things:

- **Tenant membership is organizational.** It says you are part of the Wazú org. It survives the creation, deletion, or migration of individual instances.
- **Instance membership is operational.** It says you can read/write catalog data for *this specific* instance. RLS is keyed on `instance_id`, never on `tenant_id`.

### Invariant (enforced by trigger)

> **For every `instance_member` row, there must exist a corresponding `tenant_member` row matching `(instance.tenant_id, instance_member.user_id)` with `is_active = true`.**

A trigger on `instance_member` BEFORE INSERT enforces this. Application code is responsible for inserting the `tenant_member` row first; the trigger's job is to prevent the inverse from sneaking in. This is intentionally a *precondition* check, not an auto-creation — silent auto-creation would let buggy callers paper over the wrong tenant assignment.

### The reverse is **not** required

A `tenant_member` row without any `instance_member` rows is **valid**. Concrete cases:

- A GroLabs sales-ops person who has tenant-level access to manage settings but no need to read individual catalog data.
- A user invited to a tenant who has not yet been granted access to any specific instance.
- A billing contact whose role only requires billing screens, not catalog screens.

This asymmetry is the whole point of the two-layer model: tenant access can exist without instance access.

## 2. Roles

### Tenant roles (`tenant_member.role`, CHECK-constrained)

Four values, enforced by a CHECK constraint:

| role      | What it implies                                                                                |
| --------- | ---------------------------------------------------------------------------------------------- |
| `owner`   | Full control of the tenant, including deleting the tenant and removing other owners.           |
| `admin`   | Manage instances under the tenant and manage tenant members (cannot delete the tenant itself). |
| `billing` | Manage billing settings and view billing history. No instance management, no member management.|
| `member`  | Baseline access: belongs to the tenant, can be granted instance memberships, no admin powers.  |

The column default is `'member'`. The backfill (§3) overrides this to `'owner'` for existing users, since today's `instance_member` rows are all `role='owner'` and they predate the role distinction.

### Instance roles (`instance_member.role`)

**Unchanged in this PR.** The column today is free-text with default `'owner'` and no CHECK constraint. Every existing row is `'owner'`.

A future PR will add a CHECK constraint with explicit instance-level role values. That work is **out of scope here** because:

- It requires deciding the instance role taxonomy (likely `owner | editor | viewer` or similar, but unconfirmed).
- It requires auditing every reader/writer of `instance_member.role` in the app to ensure they match.
- Bundling it would balloon this PR past its stated "schema-only, focused" scope.

## 3. Backfill rule

For each distinct `(user_id, tenant_id)` pair derivable from `instance_member ⨝ instance`, create one `tenant_member` row with:

- `role = 'owner'` (because every existing `instance_member` is `'owner'`; preserving that intent at the tenant level is the safe default)
- `is_active = true`
- `created_at = now()`, `updated_at = now()`

Use `ON CONFLICT (tenant_id, user_id) DO NOTHING` so the backfill is re-runnable.

**Expected post-backfill state (verified against production data on 2026-05-14):**

| tenant_id | tenant      | user_id                                  | role  |
| --------- | ----------- | ---------------------------------------- | ----- |
| 1         | GroLabs     | `dd2fac54-01b7-4382-8ba6-30f9ed7ae677`   | owner |
| 2         | Wazú        | `11111111-1111-1111-1111-111111111111`   | owner |
| 2         | Wazú        | `48dbe908-d303-44c7-aeb6-8c0ac8f21ccd`   | owner |

Three rows total (the Wazú user 48dbe908 is a member of instances 1 and 3 but collapses to one `tenant_member` row for tenant 2).

## 4. Trigger contract

### `trg_enforce_tenant_member_before_instance_member`

BEFORE INSERT on `public.instance_member`, per row.

**Behavior:**

1. Resolve `NEW.instance_id → instance.tenant_id`.
2. If the instance doesn't exist or has no tenant: raise (instance is malformed).
3. If no `tenant_member` row exists for `(tenant_id, NEW.user_id, is_active = true)`: raise with a message that names the user, the tenant, and instructs the caller to create the `tenant_member` row first.
4. Otherwise: allow the INSERT.

**Why BEFORE INSERT only, not UPDATE.**
`instance_member` updates don't change `user_id` or `instance_id` in any current flow. If a future PR needs to reassign membership, it should reassess and either add an UPDATE branch or document why it's safe to skip. Avoid over-fitting today's trigger to hypothetical edge cases.

**Why an exception, not a silent insert.**
Silently auto-creating a `tenant_member` row from an `instance_member` insert hides bugs where the caller has the wrong tenant in mind. We want loud failure on the precondition. Application code (signup, invite, copy-instance) owns the order: tenant_member first, then instance_member.

## 5. RLS

`tenant_member` SELECT: a user may read **only their own** `tenant_member` rows.

```sql
CREATE POLICY tenant_member_select_self ON public.tenant_member
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

`tenant_member` INSERT/UPDATE/DELETE: `service_role` only (no policy defined for `authenticated`, so writes from the user role are blocked by default). Tenant membership writes go through `SECURITY DEFINER` RPCs in future PRs (signup, invite, role change). This keeps the surface area for membership manipulation tight while the role/admin model matures.

Cross-user visibility (e.g. "list everyone in my tenant") is intentionally **not** addressed by RLS in v1. It will be exposed through admin-gated RPCs when that screen lands.

## 6. Future scenarios this enables

- **Inviting a user to a tenant without granting any instance access yet.** Insert a `tenant_member` row; defer `instance_member` until the inviter chooses which instances.
- **Tenant-level billing screens** that read `tenant_member` directly without joining through instances.
- **"Current user's home tenant" lookup** for the New Instance flow:

  ```sql
  SELECT tenant_id FROM tenant_member
   WHERE user_id = auth.uid() AND is_active = true
   LIMIT 1;
  ```

  For users who belong to multiple tenants, v1 uses the tenant of their currently-active instance (`instance_member.is_current = true → instance.tenant_id`) as the tiebreaker. The multi-tenant disambiguation UX is a separate policy doc, owned by the New Instance flow.

- **Tenant deletion cascade.** `ON DELETE CASCADE` on the `tenant_id` FK means deleting a tenant cleans up its `tenant_member` rows; instance-level cleanup is handled by existing FKs on `instance`.

## 7. Out of scope (explicitly)

- **Tenant role enforcement in application code.** The `role` column and CHECK constraint exist; readers (admin gates, billing gates) come in later PRs as those screens are built.
- **`instance_member.role` CHECK constraint** and the explicit instance-level role taxonomy — see §2.
- **UI changes.** The New Instance UI, invite UI, and tenant-switcher UI live in separate prompts.
- **Billing logic.** `tenant.billing_config` is unrelated to `tenant_member.role = 'billing'` for now; binding them is a billing-policy doc concern.
- **`updated_at` BEFORE UPDATE trigger on `tenant` / `instance` / `instance_member`.** These existing tables don't auto-touch `updated_at` today (the `set_updated_at` function exists but isn't wired up on those tables). `tenant_member` will wire it up correctly from day one; backfilling the trigger onto the older tables is a separate cleanup PR.
- **Cross-user visibility policies** on `tenant_member` (admin-listing all members of a tenant). Comes with admin tooling.

## 8. Verification checklist (post-migration)

All five queries must pass before this migration is considered applied:

```sql
-- a) Table shape
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'tenant_member'
 ORDER BY ordinal_position;

-- b) Backfill: expected 3 rows (GroLabs:1, Wazú:2)
SELECT tm.tenant_member_id, t.name AS tenant_name, tm.user_id, tm.role, tm.is_active
  FROM tenant_member tm
  JOIN tenant t ON tm.tenant_id = t.tenant_id
 ORDER BY tm.tenant_id, tm.user_id;

-- c) Enforcement trigger installed
SELECT tgname, tgrelid::regclass, tgenabled
  FROM pg_trigger
 WHERE tgname = 'trg_enforce_tenant_member_before_instance_member';

-- d) Invariant holds — must return zero rows
SELECT im.member_id, im.user_id, im.instance_id, i.tenant_id
  FROM instance_member im
  JOIN instance i ON im.instance_id = i.instance_id
  LEFT JOIN tenant_member tm
    ON tm.tenant_id = i.tenant_id AND tm.user_id = im.user_id
 WHERE tm.tenant_member_id IS NULL;

-- e) Negative test: inserting an instance_member without a tenant_member must raise
BEGIN;
  INSERT INTO instance_member (instance_id, user_id, role)
  VALUES (1, '00000000-0000-0000-0000-000000000000'::uuid, 'owner');
ROLLBACK;
```
