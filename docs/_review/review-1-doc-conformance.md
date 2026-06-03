---
application: core-app
module: Review
title: "Review 1 — Document Conformance Review"
status: Draft
scope: "19 `.md` files under `docs/`"
audience: "Maintainers deciding follow-up edits; a read-only audit grading each doc against the constitution and surfacing cross-document inconsistencies."
actors:
  - name: Reviewer
    type: human
    definition: "Claude acting as Discussion driver; performed a read-only conformance audit, edited no source doc, and deferred all actions to a follow-up Discussion."
  - name: Constitution
    type: system
    definition: "docs/constitution.md v1.0 (11 articles) — the standard every other doc is graded against. Articles 1 (industry-agnostic), 2 (one core codebase), 3 (no silent tenant registration; domain identity), 7 (RLS modeled), 9 (pricing native), 10 (repo is source of truth) drive most findings."
  - name: Audited docs
    type: system
    definition: "The 19 docs under docs/ classified as active / needs-reshape / conflicts / stale; includes the pricing design docs, search-foundations, dashboard, vision, and the three state snapshots."
rules:
  - id: R-1
    statement: "This is a read-only audit: findings only, no source doc edited, with actions deferred to a follow-up Discussion."
    truth: true
    rationale: "Header 'Status of this document' and review type."
  - id: R-2
    statement: "The two pricing design docs (README, DATA_MODEL) severely conflict by speccing pricing as a WordPress plugin with its own wp_pricing_* MySQL tables — contradicting Articles 2 & 9 (pricing is GroLabs-native core) and Article 1 (pet-specific)."
    truth: true
    rationale: "Severity summary + findings #13/#14. (These docs were subsequently marked Superseded.)"
  - id: R-3
    statement: "search-foundations.md conflicts with Article 1 by baking pet-vertical synonyms, scout_attributes (species/breed/medical), and lifestage keyword detection into the core index schema + defaults; per CLAUDE.md §18 the flaw is raised as a question, not silently fixed, because it is a locked policy doc."
    truth: true
    rationale: "Severity summary + finding #8 and its process note."
  - id: R-4
    statement: "vision.md conflicts with ratified Article 3: its §2/§4/§6.3 'every plugin install auto-registers a tenant' contradicts the explicit grolabs.ai onboarding handshake; the constitution post-dates and overrides the vision draft."
    truth: true
    rationale: "Severity summary + finding #2. (vision.md was subsequently patched to align — see state/in-flight.md.)"
  - id: R-5
    statement: "The three state docs were stale at review time (generated 2026-04-30 @ b43157a, predating the constitution and the entire tenant layer) and were flagged for regeneration as separate tasks."
    truth: true
    rationale: "Severity summary + findings #16/#17/#18. (Now regenerated to 2026-05-17.)"
  - id: R-6
    statement: "Article 3 mandates domain as the tenant primary key, but tenant-model/tenant-membership/instance-management key on slug/name and capture no domain — an unmodeled constitutional requirement across multiple docs."
    truth: true
    rationale: "Appendix B item 3 and findings #7/#9/#10."
  - id: R-7
    statement: "Algolia and Meilisearch coexist across docs with no stated transition plan, and funnel/spec.md is the only doc that models verticals correctly (jewelry/clothing/electronics templates) per Article 1."
    truth: true
    rationale: "Appendix B items 4 and 5."
useCases:
  - id: T-1
    title: "Triage a doc against the constitution"
    given: "An auditor applies the status legend (active / needs-reshape / conflicts / stale)"
    when: "They grade design/pricing/README.md, which makes WordPress the home of the pricing engine"
    then: "It is marked a severe conflict against Articles 1/2/9 and slated to be superseded (not deleted), preserving its domain model as input to the pricing-parity Discussion"
    verifies: [R-1, R-2]
  - id: T-2
    title: "Surface a cross-document contradiction"
    given: "module-map Modules 5/6 + Article 9 say pricing is core, while the pricing design docs say it is a WP plugin"
    when: "The auditor compiles Appendix B"
    then: "The two mutually exclusive architectures are recorded as a severe cross-doc inconsistency for resolution"
    verifies: [R-2]
---

# Review 1 — Document Conformance Review

**Review type:** Read-only conformance audit
**Date:** 2026-05-17
**Reviewer:** Claude (Discussion driver)
**Standard:** `docs/constitution.md` v1.0 (11 articles)
**Scope:** 19 `.md` files under `docs/`
**Status of this document:** findings only — no source doc edited; actions deferred to a follow-up Discussion

Status legend: **active** (conforms, no change needed) · **needs-reshape** (conforms in intent, structural/section fix needed) · **conflicts** (contradicts ≥1 article) · **stale** (factually outdated vs. current repo/DB)

---

## Severity summary (read this first)

| Severity | Docs | Core issue |
|---|---|---|
| 🔴 Severe conflict | `design/pricing/README.md`, `design/pricing/DATA_MODEL.md` | Pricing specced as a **WordPress plugin with its own `wp_pricing_*` MySQL tables** — contradicts Articles 2 & 9 (pricing is GroLabs-native core) and Article 1 (pet-specific) |
| 🔴 Severe conflict | `policy/search-foundations.md` | Pet-vertical synonyms, `scout_attributes` (species/breed/medical), lifestage keyword detection baked into **core index schema + defaults** — contradicts Article 1 |
| 🟠 Conflict | `design/dashboard.md` | Product defined to designer as "pet supply ecommerce stores" — contradicts Article 1 |
| 🟠 Conflict | `vision.md` | §2/§4/§6.3 "every plugin install auto-registers a tenant" — contradicts ratified Article 3 (no silent registration) |
| 🟡 Stale | `state/in-flight.md`, `state/modules.md`, `state/schema.md` | Generated 2026-04-30 @ `b43157a`; predate constitution + entire tenant layer (PRs #81/#82) |
| 🟡 Needs-reshape | `module-map.md`, `funnel/spec.md` | Internal count error; embedded superseded schema |

---

## Per-document findings

### 1. `constitution.md`
- **Covers:** The 11 ratified articles; the standard everything else is judged against.
- **Status:** active (baseline — not graded against itself).
- **Issues:** None. Note for context: Vision §6 enumerated 11 rules that map 1:1 onto these articles.
- **Action:** keep.

### 2. `vision.md`
- **Covers:** What GroLabs is, the three revenue-loss categories, core+plugins architecture, four selling shapes, ICP, Phase 1 scope.
- **Status:** **conflicts** (also self-labelled "Draft v0.2, pending review").
- **Issues:**
  - **Article 3 conflict.** §2 ("The login-plugin is the free hook. Every install auto-registers a tenant, captures the domain, and triggers GroLabs' agent to probe the merchant's store"), §4 ("Every install auto-registers a tenant"), and §6 rule 3 ("Every plugin install registers a tenant — even the free login-plugin… not signup-driven") directly contradict **Article 3**, which ratified the opposite: "Tenants are not silently auto-registered. Plugin install triggers a redirect to grolabs.ai for explicit account creation." The constitution post-dates/overrides the vision draft, but the vision text still reads as authoritative.
  - §7 Q6 ("Does the agent's auto-probe happen on install, or require separate consent?") is now partly answered by Article 3 (explicit handshake first) but the question is left open.
- **Action:** **reshape** — bring §2/§4/§6.3 into line with Article 3's explicit-onboarding model (or add an explicit "superseded by Constitution Article 3" annotation). Naming already correct (GroLabs).

### 3. `module-map.md`
- **Covers:** 18 internal modules (backend, dashboard UI, plugins) with ownership boundaries + dependency graph.
- **Status:** needs-reshape (conforms to Articles 2, 7, 9 well).
- **Issues:**
  - **Internal count error:** heading says "The 17 modules at a glance" but the document defines Modules 1–18.
  - **Naming vs. schema:** Module 1 lists tables `tenants`, `users`, `instances` (plural). Live schema + CLAUDE.md §2 + `tenant-model.md` use **singular** (`instance`, `tenant`, `instance_member`). Module map is conceptual so this is not an article violation, but it contradicts the established schema convention and should be reconciled.
- **Action:** **fix** (count + a one-line note that table names are conceptual; defer to singular schema names). Keep otherwise. Correctly places Pricing as core Modules 5/6 — this is the canonical position that the pricing design docs violate.

### 4. `backlog.md`
- **Covers:** Five parked commitments (pricing parity, pet-shop schema cleanup, WC reconciliation, consent drafting, SSO consolidation) with triggers.
- **Status:** active.
- **Issues:** None substantive. "Pet-shop-specific schema cleanup" entry is the operational arm of Article 1. References folder `scout-wordpress-social-login/` (RRE naming — rename pass).
- **Action:** keep.

### 5. `policy/README.md`
- **Covers:** Index + conventions for `docs/policy/`.
- **Status:** active (RRE naming, 4 occurrences).
- **Issues:** No article conflict. Points at "CLAUDE.md section 18" — still accurate. The `tenant-model` entry already says "GroLabs → instance 0" (mixed naming, acceptable in transition).
- **Action:** keep; RRE→GroLabs in rename pass.

### 6. `policy/ga4-integration.md`
- **Covers:** Read-only GA4 v1 — hybrid storage, 5 daily tables + alert table, OAuth, polling, alert pipeline, `/dashboard/traffic`.
- **Status:** active (RRE naming, 9 occurrences).
- **Issues:** Conforms to Article 7 (RLS modeled), Article 4 spirit (read-only, Google owns consent). Cross-doc: references the existing `/dashboard` "no-results analytics (Algolia-sourced)" — see Algolia-vs-Meilisearch inconsistency in Appendix B.
- **Action:** keep; RRE→GroLabs in rename pass.

### 7. `policy/instance-management.md`
- **Covers:** `instance_member.is_current`, topbar instance switcher, create-instance flow; fixes `.maybeSingle()` ambiguity.
- **Status:** active (RRE naming, 4 occurrences).
- **Issues:** Conforms to Article 7. Minor tension with **Article 3**: instance creation captures only a name → slug, never a **domain** (Article 3 makes domain the tenant primary key). `tenant-model.md` carries the tenant layer separately, so this is a deferred gap, not a contradiction within this doc's stated v1 scope.
- **Action:** keep; note the Article 3 domain-capture gap as deferred.

### 8. `policy/search-foundations.md`
- **Covers:** Search Stages 0 & 1 — Meilisearch Cloud, token endpoint, indexing pipeline, WP plugin v0.1, two-button variant cards.
- **Status:** **conflicts** (RRE naming, 70 occurrences — highest in repo, incl. code identifiers).
- **Issues — Article 1 (industry-agnostic core):**
  - §3 index **defaults applied at index creation**: `Synonyms (pet-domain Spanish): comida ↔ alimento ↔ kibble, perro ↔ can, gato ↔ felino`.
  - §3/§4 searchable & filterable attributes hardcode `scout_attributes.species`, `scout_attributes.breed_compatibility`, `scout_attributes.lifestage`, `scout_attributes.medical_conditions` as first-class core index fields.
  - §9 Stage-1 enrichment "detects lifestage from product-name keywords (`puppy`, `senior`, `cachorro`, `adulto`)" in core pipeline code.
  These are vertical-specific schema/assumptions in the core search engine — exactly what Article 1 forbids ("verticals exist only as instance-provisioning templates (data, not schema)").
- **Note on process:** this is a *locked* policy doc with APPROVAL checkpoints; per CLAUDE.md §18 a flaw must be raised as a question, not silently worked around — hence flagged here for decision rather than acted on.
- **Action:** **reshape** — make the indexed document schema generic (instance-configured enrichment fields rather than hardcoded species/breed/lifestage); move pet synonyms and pet enrichment to per-instance template data (the doc already defers per-instance settings to Stage 5 — pull the pet specifics there).

### 9. `policy/tenant-membership.md`
- **Covers:** `tenant_member` table, two-layer membership model, role taxonomy, enforcement trigger, backfill, RLS.
- **Status:** active — conforms (self-labelled "Draft (awaiting approval)"; 3 RRE occurrences, also uses "GroLabs" for tenant 1).
- **Issues:** Strong fit with Article 7 (modeled, RLS tight, no app enforcement) and Article 3 (two-layer/collaborator model = the "user granted access to multiple tenants without merging" mechanism). Same deferred Article 3 domain-identity gap as `tenant-model.md`.
- **Action:** keep (note draft status — not yet ratified).

### 10. `policy/tenant-model.md`
- **Covers:** `tenant` table, `instance.tenant_id`, `kind = template_owner|customer`, deprecation of `instance.kind`, GroLabs/Wazú seed.
- **Status:** active — conforms with one gap (self-labelled "Draft (awaiting approval)"; 5 RRE occurrences).
- **Issues:** Directly supports Article 1 (template ownership at the tenant level, not vertical schema) and enables Article 3's "create tenant + first instance" signup shape. **Gap vs Article 3:** Article 3 says "Tenant identity uses **domain** as the primary key — two installs from the same domain join the existing tenant." `tenant-model.md` keys tenants on `slug` (`grolabs`, `wazu`) with no domain column. This is an unmodeled constitutional requirement, not a contradiction of what the doc does ship.
- **Action:** keep; flag the domain-as-tenant-identity gap for a future policy doc (or amend Article 3's trigger-to-revisit).

### 11. `policy/wc-import.md`
- **Covers:** One-way WC→RRE pull, `woocommerce_id` mapping, `wc_raw` JSONB preservation, idempotent re-runs.
- **Status:** active (RRE naming, 27 occurrences).
- **Issues:** Strong conformance with **Article 8** (entity-to-entity mapping via `woocommerce_id`, never inferred from names/SKUs; non-destructive; variations preserved raw) and Article 2 (separate pull namespace). Minor Article 1 surface: non-goals casually list "lifestage, species, breed" — framed as deferred template/enrichment work, acceptable.
- **Action:** keep; RRE→GroLabs in rename pass.

### 12. `design/dashboard.md`
- **Covers:** Design brief for the multi-section dashboard cockpit (Traffic/Search/Catalog/Pricing/Sync), to paste into a fresh design conversation.
- **Status:** **conflicts** + stale (RRE naming, 6 occurrences; pre-constitution).
- **Issues — Article 1:** opening definition handed to the designer — *"RRE is a multi-tenant admin app for **solopreneur-run pet supply ecommerce stores** in Latin America"* — bakes the pet vertical into the product definition. Article 1 forbids vertical assumptions in documentation; vision §1 says industry-agnostic, WooCommerce-first, pet = Wazú test tenant only. Also names `scout.gro.gt`.
- **Action:** **reshape** — rewrite the "What RRE is" framing as industry-agnostic GroLabs with Wazú named only as the example tenant. Keep the layout/interaction content (which is vertical-neutral and useful).

### 13. `design/pricing/README.md`
- **Covers:** Handoff to build the pricing module as a **WordPress/WooCommerce plugin** (PHP + React SPA in wp-admin + `wp_pricing_*` MySQL tables + `/wp-json/pricing/v1/` REST API).
- **Status:** **conflicts (severe, multi-article)** + stale (pre-constitution; 0 RRE/GroLabs references — fully external framing).
- **Issues:**
  - **Article 9:** "Pricing engine is GroLabs-native… WooCommerce receives the structured result and displays final prices." This doc makes WordPress the *home* of the pricing engine (custom WP tables, WP-Cron batch processing, WP REST API). Direct inversion of the constitutional rule.
  - **Article 2:** Pricing is a **core** module (one codebase, one Supabase schema — module-map Modules 5/6). This builds it as a physically separate WP plugin with its own MySQL tables. Direct conflict.
  - **Article 1:** "pet supplies e-commerce business", "Royal Canin", "Hill's" throughout — vertical-specific.
- **Action:** **supersede** — mark the doc `Superseded` with pointers to module-map Module 5 + the pricing-parity backlog entry, preserving the domain model (charm pricing, MAP rules, margin targets, batch worksheet) as input to the pricing-parity Discussion. Non-destructive; final disposition decided in that Discussion. (Per policy/README convention: prefer Superseded status over deletion so history survives.)

### 14. `design/pricing/DATA_MODEL.md`
- **Covers:** Pricing data model (Provider, Brand, PriceList, ProductVariant, MAPRule, PriceBatch…) — the schema behind the #13 WP-plugin handoff.
- **Status:** **conflicts** (same root cause as #13; 0 RRE/GroLabs references).
- **Issues:** UUID-keyed standalone tables with **no `instance_id` multi-tenancy boundary and no RLS** (contradicts the RRE/GroLabs tenancy convention — CLAUDE.md §2, Article 7 RLS modeling). Pet-specific examples (Royal Canin, Hill's, "Distribuidora Pet Supplies S.A.") — Article 1. The *domain model* is salvageable and overlaps the pricing-parity backlog scope; the *table architecture* is superseded.
- **Action:** **supersede with #13** — preserve the conceptual model as input to the pricing-parity Discussion; retire the standalone-schema framing. Mark `Superseded` alongside #13.

### 15. `state/README.md`
- **Covers:** Purpose + update protocol for `docs/state/` (modules/schema/in-flight), context-handoff guidance.
- **Status:** active (RRE naming, 4 occurrences).
- **Issues:** Operational meta-doc; no article conflict. Aligns with Article 10 ("re-query the live DB rather than transcribing… the live DB is the source of truth").
- **Action:** keep; RRE→GroLabs in rename pass.

### 16. `state/in-flight.md`
- **Covers:** Snapshot of open PRs, branches, known debt, open architectural decisions.
- **Status:** **stale** (Generated 2026-04-30; RRE naming).
- **Issues:** Open-PR table (#17/#22/#23/#24) and branch list predate everything in `git log` (foundation-docs commit `0bf0cda`, tenant PRs #79–#82). Predates the constitution entirely. Debt list overlaps CLAUDE.md §17 but is now partially resolved (tenant layer landed). Not an article conflict — a freshness failure of the doc's own update protocol.
- **Action:** **regenerate** (separate task; out of scope for this read-only pass). Flag overlap with CLAUDE.md §17 for dedup.

### 17. `state/modules.md`
- **Covers:** Per-module current state (routes, actions, gaps) @ HEAD `b43157a`.
- **Status:** **stale** (Generated 2026-04-30; RRE naming, 2 occurrences).
- **Issues:** Describes products/variants CRUD as in-flight PR #24 and catalog images as not-yet-done; `git log` shows catalog/images (#80) and later work merged. No tenant-switcher/instance-management state. Structurally sound; content lags main.
- **Action:** **regenerate** (separate task).

### 18. `state/schema.md`
- **Covers:** Live table-by-table schema snapshot @ 2026-04-30.
- **Status:** **stale** (RRE naming, 3 occurrences).
- **Issues:** Missing the entire **tenant layer** — no `tenant` table, no `tenant_member`, no `instance_member.is_current` — all of which `git log` shows merged (PRs #81/#82) and which `tenant-model.md`/`tenant-membership.md` specify. Doc correctly states "the DB wins" (Article 10-aligned) but is now an incomplete snapshot. Flags the RRE-named DB object `scout_schema_version` and sequence `tenant_tenant_id_seq` — relevant to the rename pass (rename touches DB identifiers, not just prose).
- **Action:** **regenerate from live DB** (separate task).

### 19. `funnel/spec.md`
- **Covers:** Funnel Flow Map production spec — visual language, highlight rules, revenue formulas, validation, embedded schema/seed/TS.
- **Status:** needs-reshape (RRE naming minimal, 1 occurrence; doc self-flags the schema block as historical).
- **Issues:** Embedded PostgreSQL schema uses standalone `instances` (text PK, `tenant_id text`), **no `instance_id` tenancy, no RLS** — contradicts the reconciled live funnel schema (`schema.md` shows `funnel_*` with `instance_id` + RLS) and the RRE multi-tenancy convention. The doc's own top note says this block is superseded by `supabase/migrations/20260430000001_funnel_schema.sql`, so it is self-aware — but a superseded schema sitting inline in `docs/` is an Article 10 hazard (a future reader could treat it as authoritative). **Positive:** funnel templates are jewelry/clothing/electronics — a correct, industry-agnostic Article 1 example (contrast with the pet-coded docs).
- **Action:** **reshape** — excise or clearly quarantine the stale SQL/TS schema block; keep the canonical product rules (visual language, formulas, validation).

---

## Appendix A — RRE→GroLabs naming references (for the future rename pass)

Per the session naming decision, nothing below is changed yet. Occurrence counts (case-insensitive, includes code/DB/plugin identifiers):

| File | legacy-name count | Notes |
|---|---|---|
| `policy/search-foundations.md` | 70 | Highest. Includes **identifiers**: `scout-production` (Meili project), `scout_attributes` (index fields), `scout-search.php`, `scout_search_*` WP options, `src/lib/search/` |
| `policy/wc-import.md` | 27 | Mostly prose + `src/lib/import/woocommerce/` |
| `policy/ga4-integration.md` | 9 | Prose + `src/lib/integrations/ga4/` |
| `design/dashboard.md` | 6 | Prose + `scout.gro.gt` URL |
| `policy/tenant-model.md` | 5 | Prose; also uses "GroLabs" correctly for tenant |
| `policy/README.md`, `policy/instance-management.md`, `state/README.md`, `state/in-flight.md` | 4 each | Prose |
| `policy/tenant-membership.md`, `state/schema.md` | 3 each | `state/schema.md` includes DB object **`scout_schema_version`** |
| `state/modules.md` | 2 | Prose |
| `backlog.md`, `funnel/spec.md`, `vision.md` | 1 each | `backlog.md` references folder `scout-wordpress-social-login/` |
| `constitution.md`, `module-map.md`, `design/pricing/README.md`, `design/pricing/DATA_MODEL.md` | 0 | New docs already GroLabs; pricing docs use no product name at all |

**Rename pass is not docs-only.** It must also cover code/DB/infra identifiers: `scout_schema_version` (table), `scout_attributes` (Meili field namespace), `scout-production` (Meili project), `scout-search.php` / `scout_search_*` (WP plugin), `src/lib/` paths, `tenant_tenant_id_seq` (pre-existing misnamed sequence, CLAUDE.md §17). These need a coordinated migration, not find-and-replace.

## Appendix B — Cross-document inconsistencies

1. **Pricing architecture contradiction (severe).** `module-map.md` Modules 5/6 + Article 9 → pricing is GroLabs core (Supabase). `design/pricing/README.md` + `DATA_MODEL.md` → pricing is a WordPress plugin with `wp_` MySQL tables. Two docs in the same repo specify mutually exclusive architectures.
2. **Auto-registration vs explicit onboarding.** `vision.md` §2/§4/§6.3 (every plugin install auto-registers a tenant) vs ratified `constitution.md` Article 3 (no silent registration; explicit grolabs.ai handshake).
3. **Tenant identity unmodeled.** Article 3 mandates **domain** as tenant primary key; `tenant-model.md`/`tenant-membership.md`/`instance-management.md` key on slug/name and capture no domain. No doc models the constitutional requirement.
4. **Algolia vs Meilisearch.** `dashboard.md`, `ga4-integration.md`, `state/modules.md` reference Algolia (no-results analytics, current `/dashboard`). `vision.md` + `search-foundations.md` make Meilisearch the search engine. No doc states the Algolia→Meilisearch transition plan; "search analytics" ownership is split across both.
5. **Vertical framing split.** `dashboard.md` + `design/pricing/*` define the product as pet-supplies. `vision.md`/`constitution.md`/`module-map.md` define it as industry-agnostic with pet = Wazú test tenant. `funnel/spec.md` models this correctly (jewelry/clothing/electronics templates) — the others do not.
6. **Module count.** `module-map.md` heading "17 modules" vs 18 defined modules.
7. **Table-name convention.** `module-map.md` plural (`tenants`/`users`/`instances`) vs schema/CLAUDE/tenant-* docs singular.
8. **State docs vs reality.** `state/{in-flight,modules,schema}.md` generated 2026-04-30 @ `b43157a`; main has since merged the tenant layer and foundation docs — the state docs predate the constitution itself.
9. **Product name.** Repo/code/CLAUDE.md/most `docs/` say "RRE"; `vision/constitution/module-map/backlog` say "GroLabs". Known in-progress rename (session decision: new docs = GroLabs).

## Appendix C — Note on CLAUDE.md (out of scope, flagged)

`CLAUDE.md` (repo root, not under `docs/`, so not graded here) is entirely "RRE"-named and its §18 indexes the policy docs. It will need to be part of the same coordinated rename and re-pointed once vision/constitution/module-map are reconciled. Raised so it is not lost; no action this pass.

---

**End of Review 1.**
