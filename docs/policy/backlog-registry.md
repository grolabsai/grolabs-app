---
application: core-app
module: Policy
title: "Backlog & deferred-work registry — policy (Draft)"
status: Draft
owner: "Tuncho"
scope: "How GroLabs tracks deferred work — security items, technical debt, and deferred-enforcement decisions — as a single structured, version-controlled registry in the repo, plus a read-only admin-surface page that visualizes it. Replaces the current practice of scattering these across prose Markdown."
audience: "Claude Code (primary), future GroLabs contributors who add or close deferred-work items, or who build the visualization page."

actors:
  - name: Contributor
    type: human
    definition: Adds, edits, and closes registry items through reviewable commits and PRs, not a UI.
  - name: Visualization page
    type: system
    definition: A read-only admin-surface board that parses docs/backlog/items/ at build time and renders a filterable view grouped by type.

rules:
  - id: R-1
    statement: The deferred-work registry lives in the Git repository, not Postgres, so items are diffable, PR-reviewed, and closed via reviewable commits (Constitution Article 10).
    truth: unverified
    rationale: This doc is a proposal awaiting ratification; no schema change is implied by merging it.
  - id: R-2
    statement: The registry is one file per item under docs/backlog/items/, each with structured YAML frontmatter plus an optional Markdown body.
    truth: unverified
  - id: R-3
    statement: The visualization page is read-only — items are added, edited, and closed via commits and the parser, never via UI CRUD.
    truth: unverified
  - id: R-4
    statement: This internal dev/security backlog registry is distinct from runtime customer findings (unified-findings) and must not be merged with them.
    truth: unverified
  - id: R-5
    statement: Every spec that defers work adds a registry item and references it by id rather than burying the obligation in prose.
    truth: unverified
  - id: R-6
    statement: 'Closing an item means setting status: closed plus a closed: date in the same PR that pays it down; wont-fix is allowed with a one-line rationale in the body.'
    truth: unverified
---

# Backlog & deferred-work registry — policy (Draft)

This is a **proposal awaiting ratification** under Constitution Article 10.
It describes a registry format + a read-only visualization page. No code
or schema change is implied by merging this doc; an implementation
session builds it after approval.

---

## 1. Problem

GroLabs continuously defers work on purpose — Constitution Article 7
("build models, gate nothing in Phase 1") guarantees a steady stream of
deferred-enforcement and deferred-security items. Today those items are
scattered across prose, with no single queryable or visualizable view:

- **Constitution** — Article 7 deferrals, "compliance-deferred items"
  (Article 4), parity-clause obligations (Article 9).
- **`CLAUDE.md` §17 "Known schema debt"** — e.g. "funnel shared-write
  actions have no app-level admin gate yet"; the misnamed sequence; the
  `instance.kind` enum debt.
- **`docs/state/in-flight.md`** — open PRs, active branches, "Code-level
  (TODO comments)".
- **`docs/backlog.md`** — pricing-parity Discussion, pre-launch cleanup.
- **Per-policy "backlog (directional)" notes** — e.g. `blog.md`,
  `prospectos.md`.

Concrete trigger: the RRE/admin split (`rre-admin-split.md`) just created
a new deferred-**security** item — the `isGroLabsAdmin` gate is
default-granted in Phase 1 — and today it would land as one more bullet
in `CLAUDE.md §17` + `in-flight.md`. You cannot currently ask "show me
every open security item" or "what's deferred until role taxonomy lands."

> **SEC-001 is now scheduled for closure.** [`user-management.md`](user-management.md)
> §8 (PR 2) flips `isGroLabsAdmin()` to a real template-tenant membership
> check. When that PR lands, the corresponding registry item (once the
> registry is built) should ship `status: closed` with a `closed:` date,
> per §6. This is also the worked example used in §4 below.

## 2. Goal

One **structured, version-controlled registry** of deferred work, typed
and queryable, with a **read-only admin page** that renders it as a
filterable board. Specs reference registry items by id rather than
restating them; the registry is the single index of "things we owe."

## 3. Source of truth: repo, not DB

The registry lives in the **Git repository** — not in Postgres.

- **Why repo (Article 10):** these are decisions and obligations about
  GroLabs. The constitution makes the repo authoritative for facts and
  decisions; they must be diffable and reviewed in PRs, and survive every
  session and agent. Closing a security item is a reviewable commit, not
  a clicked button.
- **Tradeoff (accepted):** the visualization page is **read-only**. Items
  are added/edited/closed via commits + the parser, not via UI CRUD. A
  DB-backed `tech_debt` table with a CRUD admin page would allow live
  editing, but it puts decision-records in mutable rows outside version
  control, which fights Article 10. Rejected for this domain.
- **Distinct from runtime findings:** customer-facing *findings* (revenue
  leaks, UX issues from the prospect rubric / search / GA4) are runtime
  data and already have the DB-backed unified-findings design
  (`docs/design/unified-findings-and-monitoring.md`). This registry is
  *internal dev/security backlog* — a different domain. Do not merge them.

## 4. Registry format

**Recommendation: one file per item**, under `docs/backlog/items/`, each
with structured YAML frontmatter (the machine-readable fields the page
parses) plus an optional Markdown body for detail/context. This is
git-conflict-friendly as the registry grows, keeps each item reviewable
in isolation, and matches the repo's existing "one doc per concern"
ethos. (Alternative considered: a single `registry.yaml` — simpler to
parse but a merge-conflict magnet and not individually reviewable.)

Proposed frontmatter schema (refine in the build conversation):

```yaml
---
id: SEC-001                      # stable, type-prefixed, never reused
title: Admin surface gate is default-granted
type: security                   # security | debt | deferred-enforcement | compliance
severity: medium                 # low | medium | high | critical
status: open                     # open | in-progress | closed | wont-fix
area: auth                       # auth | catalog | funnel | search | blog | prospects | infra | schema
source: docs/policy/rre-admin-split.md   # the spec/decision that created it
constitution: "Article 7"        # the article that authorizes/explains the deferral (optional)
trigger: "Role taxonomy lands"   # the condition that should make us act
created: 2026-06-01
closed: null                     # date when status -> closed
owner: null                      # optional
---

`(admin)/layout.tsx` ships an `isGroLabsAdmin(user)` checkpoint that
returns granted for any authenticated user. Flip to a real
template-tenant membership check when role taxonomy is implemented.
Related: CLAUDE.md §17 funnel shared-write gate (same root cause).
```

The example above is **illustrative**, not an instruction to create the
registry now.

## 5. Visualization page

A **read-only admin-surface section** (lives on `admin.grolabs.ai`, since
it is internal GroLabs tooling — alongside blog/prospects/styleguide per
`rre-admin-split.md`). It:

- Parses every file in `docs/backlog/items/` (build-time; same spirit as
  the existing host-aware/build-time generation in the app).
- Renders a board grouped by `type`, filterable by `status`, `severity`,
  `area`, and `trigger`.
- Default view: open `security` items first (the headline use case —
  "what security work is pending"), then debt, then deferred-enforcement.
- Each card links to its `source` spec and shows the `trigger`.
- No write path. "Add/close an item" is documented as: edit the file,
  open a PR.

## 6. Lifecycle & authoring rules

- **Every spec that defers work adds a registry item** and references it
  by id, rather than burying the obligation in prose. (Amend the policy
  conventions / spec template to require this.)
- **Closing** = set `status: closed` + `closed:` date in the same PR that
  pays the item down. The git history is the audit trail.
- **`wont-fix`** is allowed with a one-line rationale in the body.

## 7. Relationship to existing registers (open — decide in build convo)

The biggest open question is consolidation vs. coexistence:

- **Option A — registry is the index, existing docs keep narrative.**
  `CLAUDE.md §17`, `in-flight.md` debt, `backlog.md`, and constitution
  deferrals each get a registry item; the prose stays for context and
  links to the id. Lowest disruption.
- **Option B — registry supersedes the scattered lists.** Migrate the
  §17 / in-flight / backlog bullets into items and trim the prose to a
  pointer at the registry. Cleaner long-term, more upfront churn, and
  touches the constitution-adjacent docs (needs care).

Recommendation: start with **Option A**, migrate opportunistically.

## 8. Constitutional compliance

- **Article 10 — repo is source of truth.** Satisfied: the registry is
  version-controlled, PR-reviewed, diffable. The DB alternative was
  rejected precisely to honor this.
- **Article 7 — build models without enforcement.** This registry is the
  natural home for the deferred-enforcement items Article 7 generates;
  it makes the "modeled but not enforced" set explicit and trackable.
- **Article 2 — one deployable.** The visualization page is a route in
  the single app's admin surface; no new deployable.

## 9. Open questions for the build conversation

1. **Frontmatter schema** — confirm/extend the fields in §4 (e.g. do we
   want `effort` / `links` / `blocked_by`?).
2. **File-per-item vs. single file** — confirm §4's file-per-item
   recommendation.
3. **Consolidation strategy** — Option A vs. B from §7.
4. **Seeding set** — which existing items to import first (suggest: the
   §17 debt list + the RRE-split `SEC-001` gate + Article-7 deferrals).
5. **Page scope** — is the board read-only forever, or is a future
   "request-to-close" / status-nudge workflow wanted (would push toward a
   thin DB layer later)?
6. **Access** — the page is on the admin surface; gated by the same
   default-granted admin gate (`SEC-001`). Confirm that's acceptable, or
   whether the backlog should be public like the style guide.
