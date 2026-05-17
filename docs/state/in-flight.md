# GroLabs — In-flight (current state)

**Regenerated:** 2026-05-17
**Source commit:** `2f200e2` (HEAD of branch `claude/strange-gates-28d046`)
**Method:** `git status`, `git branch -a`, `git log main..HEAD`, doc-header inspection. Repo is source of truth (Constitution Article 10).

> Supersedes the 2026-04-30 @ `b43157a` snapshot, which predated the constitution and the tenant layer.

---

## Working tree

Clean — no uncommitted or untracked files at regeneration time (the `docs/_review/` report and the Pass-4 doc edits are all committed).

## Current branch vs main

Branch `claude/strange-gates-28d046` is **6 commits ahead of `main`**, not yet merged, not yet pushed at the time this section was written:

| SHA | Commit |
|---|---|
| `2f200e2` | docs(design): reframe dashboard for industry-agnostic audience |
| `d9225f2` | docs(design/pricing): mark as superseded with pointers to authoritative sources |
| `fbd66bf` | docs(policy): reshape search-foundations.md, move vertical specifics to templates |
| `8d3e6a7` | docs(vision): align with Constitution Article 3, remove auto-registration language |
| `2986fc2` | Add Review 1 doc conformance report |
| `0bf0cda` | Add foundation documents: vision, constitution, module map, backlog |

## Draft documents (awaiting approval)

- `docs/policy/tenant-model.md` — header `Status: Draft (awaiting approval)`. Schema (`tenant` table, `instance.tenant_id`) is **already migrated** (`20260513000001_add_tenant_layer.sql`); the policy doc itself is not yet ratified.
- `docs/policy/tenant-membership.md` — header `Status: Draft (awaiting approval)`. Schema (`tenant_member`) is **already migrated** (`20260514000001_add_tenant_member.sql`); doc not yet ratified.
- `docs/vision.md` — self-labelled `Draft v0.4` (pending review); patched this pass to align with Constitution Article 3.

## Other branches present (not merged into this branch)

Selected local/remote branches observed via `git branch -a` (not exhaustive history; glosses inferred from branch names):

- `docs/foundation` — a separate docs branch; **the Pass-4 work was committed on `claude/strange-gates-28d046`, not here** (branch-name mismatch flagged across sessions).
- `chore/docs-audit-2026-05`, `claude/pedantic-fermat-5cb361`, `claude/goofy-wing-5812e4`, `claude/crazy-zhukovsky-5ef2fa` — assorted working branches.
- `feat/tenant-layer`, `origin/feat/tenant-member` — tenant-layer feature branches (schema landed in migrations on this branch's history).
- `feat/images-complete`, `fix/product-images-bundle`, `feat/product-wc-id-roundtrip`, `feat/product-roundtrip` — catalog/image/sync work.
- `feat/ga4-dashboard-ui`, `tmp-ga4-ui`, `tmp-ga4-backend`, `feat/ga4-integration` — GA4 integration work.
- `feat/search-stage-1` — Meilisearch search Stage 1.
- `feat/wc-import`, `feat/instance-management`, `feat/instance-current-backend` — WC import + instance management.
- `fix/providers-brands-ui`, `fix/charm-ends-in-whole`, `fix/category-margins-editable`, `revert/dashboard-76` — pricing/UI fixes.
- `docs/search-foundations-contract-clarification`, `docs/instance-management-policy` — policy-doc branches.

## Known debt (still open; cross-reference CLAUDE.md §17)

- `instance.instance_id` sequence default still named `tenant_tenant_id_seq` (pre-rename artifact). Note: `20260514000001_add_tenant_member.sql` already renamed the **`instance_member`** dependent objects off their old `tenant_member_*` names; the `instance` sequence rename is still outstanding.
- `instance.kind` deprecated, not dropped — trigger keeps it in sync with `tenant.kind` during the deprecation window (`20260513000001`).
- Catalog vs funnel RLS asymmetry (template fallthrough on SELECT) — unchanged.
- Quantity-attribute dimension filtering in the variant editor — unchanged.
- Funnel per-tenant / shared-table write policies lack app-level role gating — unchanged.

## Open architectural decisions

- **Catalog template-fork pattern** — whether catalog adopts the funnel's `tenant_read` + template-fallthrough RLS for starter content on new-instance provisioning. Trigger to revisit: next new customer instance provisioned. (Now also relevant to `tenant-model.md`'s "create tenant + first instance" signup shape.)
- **Domain-as-tenant-identity** — Constitution Article 3 mandates domain as the tenant primary key; `tenant`/`tenant_member` are keyed on slug, no domain column. Unmodeled constitutional requirement (flagged in Review 1).
