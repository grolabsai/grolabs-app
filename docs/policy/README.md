# GroLabs — Policy documents

Authoritative specs for feature surfaces. Read the relevant policy doc
**before** writing any code in its scope. Decisions inside a policy doc
are locked — if implementation reveals a flaw, raise it as a question
rather than working around it.

## Active policies

- **search-foundations.md** — Stages 0 & 1 of the GroLabs search roadmap.
  Foundations (Meilisearch Cloud project, token-issuing endpoint, admin
  connection status) and basic search live on Wazú (indexing pipeline,
  WordPress plugin v0.1, two-button variable-product cards). Owner:
  Tuncho.
- **wc-import.md** — One-way pull from WooCommerce into GroLabs's catalog
  tables. Categories and products only; raw data preservation, no
  enrichment, no variant restructuring. Future processes handle those.
  Owner: Tuncho.
- **ga4-integration.md** — Read-only Google Analytics 4 integration.
  Daily snapshots into GroLabs's DB plus on-demand real-time queries.
  Alert pipeline for top-3 traffic-health metrics. Daily-digest
  dashboard surface at `/dashboard/traffic`. Owner: Tuncho.
- **instance-management.md** — Multi-instance support for a single
  logged-in user. Topbar dropdown to switch instances + create new
  ones. Adds `instance_member.is_current` column with partial unique
  index. Replaces `.maybeSingle()` on `is_active` ambiguity.
  Owner: Tuncho.
- **tenant-model.md** — Tenant layer above `instance`. Adds a `tenant`
  table (kind=`template_owner`|`customer`) and `instance.tenant_id`.
  Deprecates `instance.kind` (kept + sync-trigger during the
  deprecation window). Backfills GroLabs → instance 0, Wazú →
  instances 1 and 3. Owner: Tuncho.
- **tenant-membership.md** — Direct user-to-tenant membership via a
  new `tenant_member` table, parallel to `instance_member` one layer
  up. Tenant roles `owner|admin|billing|member`. BEFORE INSERT trigger
  on `instance_member` enforces a matching active `tenant_member`
  row. Backfills 3 (tenant, user) pairs from existing instance
  memberships. Owner: Tuncho.

## Conventions

- One policy doc per feature surface, named `<feature>.md`.
- Each doc opens with `Status:`, `Owner:`, `Scope:`, `Audience:` lines.
- Sections labeled **APPROVAL REQUIRED** are hard checkpoints — stop
  and wait for explicit approval before proceeding.
- Out-of-scope items are listed at the bottom and pointed at the future
  policy doc that will own them (e.g. `search-events.md` for Stage 4).
- When a policy is superseded, change `Status:` to `Superseded by
  <new-doc>.md` rather than deleting it — the history matters.

## Adding a new policy doc

1. Draft the doc in `docs/policy/<feature>.md` with the standard
   frontmatter.
2. Add a one-line entry to the "Active policies" section above.
3. Add a one-line entry under "Active policy docs" in CLAUDE.md
   section 18.
4. Open a PR labeled as documentation-only.
