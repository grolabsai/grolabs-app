# GroLabs Instance Management — v1

Status: Active policy
Owner: Tuncho
Scope: A logged-in user's ability to belong to multiple GroLabs instances, switch between them via a topbar dropdown, and create new ones. v1 is the minimum interactive surface — invitations, role management, renames, and template seeding are deferred.
Audience: Claude Code (primary), future GroLabs contributors

This document is the authoritative spec. Read it before writing any code. Stop at the two `APPROVAL REQUIRED` checkpoints (§7 and §8) and wait for explicit approval.

## 1. Goals and non-goals

### Goal
A user with multiple `instance_member` rows can:
1. See a dropdown in the topbar listing every instance they belong to, with the current one highlighted
2. Click any other instance in that list to switch context (entire admin reloads scoped to the new instance)
3. Click "+ Nueva instancia" at the bottom of the dropdown to spawn a new instance from a name input, automatically becoming its owner and switching into it

The current `.maybeSingle()` ambiguity (multiple `is_active=true` memberships causing undefined behavior) gets fixed as part of this work.

### Non-goals
- Inviting other users to an instance (separate `instance-invitations.md` later)
- Per-instance role management beyond owner (separate)
- Renaming or deleting instances (separate; for now, owner gets a fixed slug)
- Seeding from template categories/attributes (separate; v1 instances start empty per CLAUDE.md §17 known debt)
- URL-based instance routing (`/scout/[instance_id]/...` — explicitly rejected; instance is resolved server-side from `is_current` membership)

## 2. Architectural decisions (locked)

If implementation surfaces a flaw, raise it as a question — don't work around it silently.

**Add `instance_member.is_current` boolean.** Existing `is_active` keeps its meaning ("user has access to this instance"). New `is_current` means "this is the instance the UI is showing right now." A user has at most one `is_current=true` membership at a time, enforced by a partial unique index.

**Backfill rule on migration:** for every existing user, set `is_current = true` on the row that was their (only) `is_active = true` membership. This preserves existing behavior — every current user keeps seeing the same instance after the migration.

**Switching is a server action that flips booleans.** `switchToInstance(instanceId)`: validates the user has membership on `instanceId`, sets `is_current=false` on all their other memberships, sets `is_current=true` on the target. RLS-safe via service-role client (the lookup spans rows the user could otherwise not see for unrelated users).

**Replace existing `.maybeSingle()` queries.** Every page that currently does `instance_member.select('instance_id').eq('user_id', user.id).eq('is_active', true).maybeSingle()` switches to filtering on `is_current = true` instead. Same return shape. This is a localized find-and-replace.

**Creation gives the creator role 'owner' and `is_current=true`.** No invite step in v1. The creator immediately switches to the new instance.

**Empty defaults on creation.** New instances start with no categories, attributes, or products. Template seeding is deferred per CLAUDE.md §17. Required fields auto-default: `kind='customer'`, `primary_locale='es-GT'`, `default_currency='GTQ'`, `is_active=true`, `integrations_config='{}'`, `storefront_domains='{}'`.

**Slug derivation:** `lower(regex_replace(name, '[^a-z0-9]+', '-'))` plus a numeric suffix if collision (e.g. `mi-tienda-2`). Rejects empty after sanitization.

**Topbar UI lives in `src/components/shell/TopBar.tsx`.** Shadcn `<Select>` or `<DropdownMenu>` — picker decides. Reserve right-quarter agent panel space per CLAUDE.md §14 — instance switcher goes on the LEFT side of the topbar where the current `instanceName` text already renders, not the right.

**Multi-tenancy boundary uses `instance_id`.** Same as everywhere else.

## 3. Schema additions

```sql
-- One column on instance_member.
alter table public.instance_member
  add column is_current boolean not null default false;

-- Backfill: every user's currently-active membership becomes their current one.
-- Existing data has at most one is_active=true per user, so this is unambiguous.
update public.instance_member
set is_current = true
where is_active = true;

-- Enforce: at most one current membership per user.
create unique index uq_instance_member_user_current
  on public.instance_member (user_id)
  where is_current = true;

comment on column public.instance_member.is_current is
  'True for the membership the user is currently looking at in the UI. Exactly one per user, enforced by partial unique index. Switched via switchToInstance server action. Per docs/policy/instance-management.md.';
```

Update or add an RPC `current_instance_id()` that returns the instance_id of the auth user's `is_current=true` membership, used by RLS policies and any server code that needs the current instance for an unauthenticated-by-cookie context.

## 4. Server actions

Live in `src/lib/actions/instance.ts` (new file).

```ts
// Validates membership, flips is_current booleans atomically.
async function switchToInstance(instanceId: number): Promise<
  | { ok: true }
  | { ok: false; error: 'not_a_member' | 'unknown' }
>;

// Creates instance + ownership membership + switches to it. Returns the new instance_id.
async function createInstance(name: string): Promise<
  | { ok: true; instanceId: number }
  | { ok: false; error: 'invalid_name' | 'unknown' }
>;
```

After either action: `revalidatePath('/', 'layout')` so every server component re-evaluates its instance scope. Client components reading from server actions should `router.refresh()` after success.

## 5. Topbar dropdown UX

Replace the static `<span>{instanceName}</span>` (or wherever it currently renders) with a dropdown:

```
┌─────────────────────────────┐
│ Wazu                ✓       │   ← current, with checkmark
│ Test Wazú                   │   ← other instances the user belongs to
│ Demo Pet Shop               │
├─────────────────────────────┤
│ + Nueva instancia           │   ← creation entry point
└─────────────────────────────┘
```

- Trigger: text of current instance name + small chevron, same visual weight as the existing label
- On open: list all `instance_member` rows for the user where `is_active=true`, sorted by `instance.name`
- Click another instance → call `switchToInstance(id)` → on success `router.refresh()` and the page renders under the new instance
- Click "+ Nueva instancia" → open modal with single name input + create button → on success same refresh flow
- No keyboard shortcuts in v1, no search inside the dropdown (assume <10 instances per user; if you have more, you can scroll)

## 6. Create-instance modal

Single field: name (required, 1-80 chars after trim). Auto-derived slug shown read-only below the input as live preview.

Submit: calls `createInstance(name)`. On success: modal closes, page refreshes scoped to the new instance (sidebar updates, etc.).

Help text under the name input: "Tu nueva instancia empezará vacía. Configura WooCommerce, Meilisearch y demás integraciones desde Configuración después de crearla."

## 7. APPROVAL REQUIRED — Checkpoint 1
Before code:
1. Confirm understanding.
2. Identify ambiguities (don't manufacture them).
3. Propose the file tree (migration, action file, TopBar refactor, modal component, list of `.maybeSingle()` call-sites being switched).
4. Wait for explicit approval.

## 8. APPROVAL REQUIRED — Checkpoint 2
After code:
1. Apply the migration, verify with `information_schema` and a manual query showing the partial index exists.
2. Confirm `npm run typecheck` and `npm run build` pass.
3. Smoke test: create a new instance, verify it appears in the dropdown, switch into it, verify the sidebar updates, switch back, verify the original instance is restored.
4. Report. Wait before merging.

## 9. Test cases

- User with single membership → dropdown shows only that instance with checkmark, plus "+ Nueva instancia"
- User with three memberships → all listed, current one checkmarked
- Switch to another instance → page reloads, sidebar shows new instance name, products/categories scoped to new instance
- Create new instance "Mi Nueva Tienda" → slug becomes `mi-nueva-tienda`, user becomes owner, page reloads scoped to the new empty instance
- Create with name that collides with existing slug → slug becomes `mi-nueva-tienda-2`
- Create with empty name → submit disabled / clear error
- Create with whitespace-only name → submit disabled
- Create with all-special-chars name (e.g. "🌟🌟") → submit disabled (sanitized slug is empty)
- Concurrent switches from two browser tabs → last wins, no orphaned `is_current=true` rows (partial unique index enforces this)
- Race condition: user clicks switch on Instance A while another tab is switching to Instance B → second action wins because the first row's update would violate the unique index unless properly ordered (use UPDATE ... WHERE user_id=X to clear all, then UPDATE target — wrap in single transaction)
- Page that previously called `.maybeSingle()` on `is_active=true` now uses `is_current=true` and returns the right row

## 10. Out of scope (future policies)

- `instance-invitations.md` — invite other users to an instance with role assignment
- `instance-roles.md` — full role taxonomy (owner / admin / editor / viewer)
- `instance-rename-delete.md` — let owners rename or delete instances
- `instance-templates.md` — seed new instances from template categories / attributes (resolves CLAUDE.md §17 known debt)

## 11. Resolved decisions

These have been resolved through Tuncho's direction (2026-05-09):

1. **Build this now**, in parallel with the search/import work, not deferred. Logging in with different emails to test multi-instance is too painful.
2. **Topbar dropdown** is the UX, not URL routing.
3. **`is_current` column on `instance_member`**, partial unique index, server action to flip — not cookie-based or JWT-based.
4. **Anyone can create an instance**, becomes its owner. No permission gate in v1.
5. **Empty seeding** in v1; template seeding is a separate future feature.
