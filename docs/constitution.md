---
application: core-app
module: Foundation
title: "GroLabs — Constitution (v1.0)"
status: Active
owner: "Tuncho (with Claude as scribe)"
scope: "The non-negotiable rules that govern every spec, feature, and code change in GroLabs. Where this conflicts with any other document, the constitution wins. Amended only through deliberate, dated Discussion events."
audience: "Every contributor (human or agent) writing any spec or code in GroLabs core or plugins."

actors:
  - name: GroLabs core
    type: system
    definition: One codebase, one schema, one deployable, multi-tenant by instance_id. Owns canonical entity UUIDs, pricing logic, the search index, analytics, and the optimization agent (Articles 1, 2, 8, 9).
  - name: Plugin
    type: plugin
    definition: Physically separate codebase running on the merchant's WordPress, talking to core only through the public API. Never shares libraries with core beyond a thin client SDK (Article 2). Names are functional/source-based (Article 11).
  - name: Merchant
    type: human
    definition: The tenant, identified by domain as primary key. Registers through an explicit handshake at grolabs.ai, never silently on install (Article 3). Retains revocable controls but defaults are full-activation (Article 4).
  - name: Optimization Agent
    type: system
    definition: Pure, industry-agnostic, stateless capability module. Accepts inputs and produces proposals; does not know who called it or why. Workflow context lives in the calling module (Article 12).
  - name: Contributor
    type: human
    definition: Author of record for specs and amendments. Flags repo/memory conflicts explicitly rather than silently resolving them (Article 10).

rules:
  - id: R-1
    statement: Industry-agnostic core — no vertical-specific naming, schema, columns, tables, or assumptions in core code, DB, or docs. Verticals exist only as instance-provisioning templates (data, not schema); Wazú is one tenant among many with no privileged code path.
    truth: true
    rationale: Article 1. Permanent, no trigger to revisit. Vertical assumptions in schema permanently shape the product; the pet-shop bridge table is debt to be dropped.
  - id: R-2
    statement: One core codebase, one schema, one deployable; plugins are physically separate codebases, separately distributed and versioned, communicating only through the public API.
    truth: true
    rationale: Article 2. Plugins run on the merchant's WP, not GroLabs' infra; entitlements cannot be flipped across separately-deployed apps. Expands (never narrows) for any future connector.
  - id: R-3
    statement: Plugin-driven funnel with explicit onboarding — install redirects to grolabs.ai for explicit account creation; tenants are never silently auto-registered. Tenant identity is keyed by domain; email is unique per user, not per tenant. Cross-tenant access is solved by a collaborator model, not by merging tenants.
    truth: true
    rationale: Article 3. Silent registration is a privacy/trust violation; explicit handshake is the only acceptable consent surface.
  - id: R-4
    statement: Frictionless value delivery; compliance through disclosure — defaults are the most value-delivering option, not the most data-minimizing; compliance is achieved via disclosure (consent paragraphs, privacy policy, ToS, in-product transparency), not opt-in friction. Controls to revoke/limit are clearly exposed.
    truth: true
    rationale: Article 4. SMB SaaS adoption is friction-sensitive; the Shopify/Stripe default-on model is the proven pattern. Consent/policy/ToS drafting is compliance-deferred to pre-launch.
  - id: R-5
    statement: 'One switch in the search-plugin — a single toggle controls data flow: search-only (no behavioral data) or full mode (search + commerce events + revenue). The toggle lives in the dashboard, defaults ON. The middle ground (events without money) is rejected.'
    truth: true
    rationale: Article 5. A third toggle state would serve a customer segment the market data shows does not meaningfully exist.
  - id: R-6
    statement: Clerk-delegation is solved inside GroLabs via the per-member financial_data_visible flag, evaluated in the dashboard UI. When false, currency values are blanked (not placeholder chars); trends remain visible. The plugin always sends what it sends; the dashboard decides what to render.
    truth: true
    rationale: Article 6. Solving this at the plugin layer would destroy the analytics product for everyone; the UI layer keeps GroLabs whole.
  - id: R-7
    statement: Phase 1 builds models without enforcement — every model needed at scale (entitlements, roles, multi-tenancy, sync identity, RLS) is modeled in schema and referenced in code, but enforcement is deferred until it is the bottleneck. In Phase 1 role checks pass through to admin-everywhere, entitlement checks always return granted, RLS is present but permissive.
    truth: true
    rationale: Article 7. "Define everything, gate nothing" until commercial readiness; building enforcement early creates premature complexity. This article is the source of the deferred-work registry's items.
  - id: R-8
    statement: Sync identity through entity-to-entity mapping — GroLabs owns the canonical UUID for every entity; external IDs (WC product/variation, Meilisearch doc) are stored as mapped references, never inferred from names/SKUs. Sync is non-destructive — restructuring preserves original external IDs at the appropriate entity level.
    truth: true
    rationale: Article 8. Inferring identity from names/SKUs causes silent duplicates and wrong updates; destroying external IDs breaks merchant trust and downstream references.
  - id: R-9
    statement: Pricing engine is GroLabs-native — GroLabs is the source of truth for product structure and pricing; WC displays the synced final price and loses on price-conflict (next sync overrides, with a drift signal). Tax computation stays with WC. Parity clause — GroLabs pricing must reach functional parity with WC before MVP launch (parity Discussion required, tracked in backlog).
    truth: true
    rationale: Article 9. A pricing engine with rules/approvals/conditionals cannot be expressed in WC's flat price field; parity ensures GroLabs is strictly additive.
  - id: R-10
    statement: Repository is the permanent source of truth — specs, decisions, schema, code, config all live in the version-controlled repo; memory, conversation history, and external notes are hints, never authoritative. On repo/memory conflict, flag explicitly and wait for the user; do not silently resolve.
    truth: true
    rationale: Article 10. Permanent, no trigger. The repo is the only artifact that survives every session, agent, and team change.
  - id: R-11
    statement: Plugin names are functional, source-based, decoupled from marketing — technical names follow [domain]-plugin or [source]-plugin; marketing names live on the product wrapper. The WP directory slug grolabs-[name]-plugin is permanent; display names may change with rebranding.
    truth: true
    rationale: Article 11. Marketing names change every few years; WP directory slugs cannot change once published.
  - id: R-12
    statement: Agent capabilities are agnostic, stateless, and reusable — Optimization Agent functions are pure and industry-agnostic; they accept inputs and produce proposals without knowing the caller or context. Workflow context (when to invoke, how to surface proposals, who approves, how to apply) belongs in the calling module.
    truth: true
    rationale: Article 12 (added 2026-05-17 from the search-foundations reshape Discussion). This decoupling is what keeps the agent reusable across import, sweeps, review-all, and first-sync probe.

useCases:
  - id: T-1
    title: Constitution wins on document conflict
    given: A spec, plan, README, code comment, or memory contradicts a constitutional article
    when: The conflict is detected during work
    then: The constitutional article governs; the conflicting work is rejected regardless of convenience or speed
    verifies: [R-10]
  - id: T-2
    title: Amendment only through dated Discussion
    given: An article's trigger-to-revisit condition is met
    when: A change to the constitution is wanted
    then: An explicit amendment is proposed, discussed, approved, and dated in the amendment log — not introduced by implicit drift
    verifies: [R-7]
  - id: T-3
    title: Same domain joins existing tenant
    given: Two users from the same merchant domain sign up independently
    when: The second install completes its explicit handshake at grolabs.ai
    then: Both join the same domain-keyed tenant rather than creating a duplicate; each user keeps a unique email
    verifies: [R-3]
---

# GroLabs — Constitution (v1.0)

**Status:** Ratified
**Date:** 2026-05-16
**Author of record:** Tuncho (with Claude as scribe)

---

## Preamble

This document codifies the non-negotiable rules that govern every spec, feature, and code change in the GroLabs product. The rules below are not aspirations or preferences — they are constraints. Any work that violates a constitutional article is rejected, regardless of how convenient or fast that work might be.

The constitution is amended through deliberate Discussion events, not through implicit drift. If an article's "trigger to revisit" condition is met, an explicit amendment is proposed, discussed, approved, and dated.

Where this document conflicts with any other document (specs, plans, README files, code comments, memory), the constitution wins.

---

## Article 1 — Industry-agnostic core

**Rule:** No vertical-specific naming, schema, columns, tables, or assumptions in GroLabs core code, database, or documentation. Verticals exist only as instance-provisioning templates (data, not schema). Wazú is the pet-shop test case — one tenant among many — and has no privileged code path.

**Sub-rule:** Any existing schema, column, or table that encodes vertical-specific assumptions is technical debt and must be removed before the constitution is honored in practice. The current bridge table designed for pet-shop product-customer attribute matching is to be dropped. Concepts of attribute-based matching may return later as a configurable, industry-agnostic feature.

**Why non-negotiable:** Once vertical-specific assumptions leak into schema or core code, the product is permanently shaped by them. Removing them later requires migration of every tenant. Vigilance now costs orders of magnitude less than cleanup later.

**Trigger to revisit:** None. This rule is permanent.

---

## Article 2 — One core codebase, multiple plugin codebases

**Rule:** GroLabs core is one codebase, one schema, one deployable system. Plugins are physically separate codebases, separately distributed, separately versioned. Plugins communicate with core through the public API; they do not share libraries with core beyond a thin client SDK if one exists.

**Why non-negotiable:** Plugins run on the merchant's WordPress infrastructure, not GroLabs'. They cannot share a deployment with core. Core must be one codebase so feature entitlements work — entitlements cannot be flipped across separately-deployed apps.

**Trigger to revisit:** If GroLabs ever builds a non-WordPress connector (Shopify app, Magento extension), each is its own codebase under the same rule. The rule expands, never narrows.

---

## Article 3 — Plugin-driven funnel with explicit onboarding

**Rule:** The customer journey begins with a plugin install or an external integration connection. Plugin install triggers a redirect to grolabs.ai for explicit account creation. The merchant signs up at grolabs.ai (email, domain confirmed), receives an API key or tenant ID, and pastes it back into the plugin to activate the connection.

Tenants are not silently auto-registered. Tenant identity uses **domain** as the primary key — two installs from the same domain join the existing tenant rather than creating a new one. Email is unique per user, not per tenant.

The agency / multi-tenant-collaboration case is solved through a collaborator model (a user can be granted access to multiple tenants without those tenants merging) — not by merging or duplicating tenants.

**Why non-negotiable:** Silent registration is a privacy and trust violation. Explicit handshake is the only acceptable consent surface. Domain-based tenant identity prevents fragmentation when multiple users from the same merchant sign up independently.

**Trigger to revisit:** If GroLabs ever adds a non-plugin entry path (direct signup on grolabs.ai, partner-referred onboarding), the rule expands to "every entry path registers a tenant explicitly." Never narrows.

---

## Article 4 — Frictionless value delivery; compliance through disclosure

**Rule:** GroLabs never asks the merchant to take an additional action to unlock value they could benefit from. Defaults are set to the most value-delivering option, not the most data-minimizing option. Compliance with privacy regulations is achieved through proper disclosure (consent paragraphs at signup, privacy policy, terms of service, in-product transparency), not through opt-in friction.

The merchant always retains the ability to revoke or limit data sharing inside the GroLabs dashboard. These controls are exposed clearly and not buried in submenus. But the default state across the product is full activation.

**Why non-negotiable:** SMB SaaS adoption is friction-sensitive. Every additional opt-in checkbox loses a percentage of activations. The Shopify/Stripe model (default-on, compliant through legal terms, controls available if requested) is the proven SMB pattern. Privacy-purist defaults are rejected as a product philosophy.

**Compliance-deferred items:** Drafting of consent paragraphs, privacy policy, terms of service, and the dashboard revocation UX is deferred to pre-launch. The rule binds in spirit from Phase 1; implementation work happens before public availability.

**Trigger to revisit:** If GroLabs ever serves a regulated EU market or a vertical with stricter consent requirements, the rule may be amended to add region-specific or vertical-specific opt-in flows. Until then, the default-on philosophy stands.

---

## Article 5 — One switch in the search-plugin

**Rule:** The search-plugin has one toggle that controls data flow to GroLabs. Search-only mode means the plugin handles search and sends no behavioral data to GroLabs. Full mode means the plugin sends search events, commerce events (add to cart, remove from cart, checkout, purchase), and revenue figures to GroLabs.

The toggle lives in the GroLabs dashboard at grolabs.ai. The plugin contains a "Configure in GroLabs" link to that location. The toggle is **default ON** (full mode), consistent with Article 4.

The middle ground (events without money) is rejected. The market data does not support a customer segment that wants event tracking without revenue tracking; both populations collapse into "Search only" or "Full mode."

**Why non-negotiable:** A third toggle state creates a UX path in the analytics module that must serve a population that doesn't meaningfully exist. The complexity is real; the demand is not.

**Trigger to revisit:** If post-launch customer data shows a meaningful number of merchants explicitly requesting "events without money," the toggle becomes three-state. Not before, and not on hypothesis.

---

## Article 6 — Clerk-delegation solved inside GroLabs

**Rule:** The merchant's need to delegate work to staff without exposing revenue numbers is solved through the per-member `financial_data_visible` flag, evaluated in the GroLabs dashboard UI. When the flag is false: currency values are blanked (rendered as empty space, not replaced with placeholder characters). Trends (up, down, flat) remain visible. The plugin layer is not involved in this decision — the plugin always sends what it sends; the dashboard decides what to render.

**Why non-negotiable:** Solving this at the plugin layer (turning off data collection) destroys the analytics product for everyone, including the owner. Solving it at the UI layer keeps GroLabs whole.

**Trigger to revisit:** If demand emerges for more granular financial gating (e.g., "show order count but hide AOV"), the flag system extends. Enforcement does not move back to the plugin layer.

---

## Article 7 — Phase 1 builds models without enforcement

**Rule:** Every model GroLabs needs at scale (entitlements, roles, multi-tenancy, sync identity, RLS policies) is modeled in the Phase 1 schema and referenced in code paths. Enforcement is deferred until enforcement is the bottleneck. In Phase 1, role checks may pass through to admin-everywhere defaults; entitlement checks may always return granted; RLS policies are present but permissive.

**Sub-rule (entitlements):** Entitlements as a concept are modeled in the schema and referenced in code paths from Phase 1. Enforcement (gating features, billing tie-in, trial logic, free-vs-paid distinctions) is deferred. In Phase 1, every entitlement check returns "granted."

**Why non-negotiable:** Building the model first protects against schema-level rework later. Building enforcement too early creates premature complexity. The discipline is "define everything, gate nothing" until commercial readiness demands gating.

**Trigger to revisit:** Phase 2 begins when GroLabs has paying customers and the absence of enforcement creates business risk. Each gating system (entitlements, roles, RLS) is turned on as needed, never speculatively.

---

## Article 8 — Sync identity through entity-to-entity mapping

**Rule:** GroLabs owns the canonical UUID for every entity it manages (products, variations, categories, attributes). External system IDs (WC product ID, WC variation ID, MeiliSearch document ID) are stored as mapped references, never inferred from names, SKUs, or any other heuristic.

The mapping is entity-to-entity. A GroLabs product maps to a WC product ID. A GroLabs variation maps to a WC variation ID. The mapping mechanism may live as extra columns on the entity table (Phase 1, single external system) or as a separate mapping table (Phase 2+, multiple external systems) — this is an implementation detail, not a constitutional matter.

**Sync is non-destructive.** When GroLabs restructures a catalog (e.g., converts five simple WC products into one variable parent with five variations), the original external IDs are preserved at the appropriate entity level. Order history, external links, and downstream references remain intact.

**Why non-negotiable:** Inferring identity from names or SKUs causes silent duplicates and silent wrong updates. Destroying external IDs during restructuring breaks merchant trust and external references.

**Trigger to revisit:** Cross-tenant references (template products shared across tenants) are explicitly out of scope. If ever introduced, the mapping principle holds: GroLabs owns the canonical ID; external references are explicit.

---

## Article 9 — Pricing engine is GroLabs-native, with parity required

**Rule:** GroLabs is the source of truth for product structure and pricing. WooCommerce receives the structured result and displays final prices. GroLabs always wins on price-conflict: if a merchant edits a price directly in WC admin, the next sync cycle overrides it, with a "price drift detected" signal surfaced in the GroLabs dashboard.

Tax computation remains with WooCommerce — GroLabs sends the final pre-tax price; WC applies the merchant's configured tax rules.

**Parity clause:** GroLabs' pricing model must achieve functional parity with WooCommerce's pricing capabilities before MVP launch. The merchant must never lose access in GroLabs to a pricing capability they previously had in WC. A pricing-parity Discussion event is required (and tracked in `backlog.md`) before the catalog-integration spec is written.

**Why non-negotiable:** A pricing engine with logic, rules, approval workflows, and conditionals cannot be expressed in WC's flat price field. If WC is authoritative, the engine ceases to exist. Parity ensures GroLabs is strictly additive — it adds capability, never removes it.

**Trigger to revisit:** If GroLabs ever needs to support marketplaces (Amazon, eBay) where the platform owns repricing decisions, the rule needs a platform-specific exception clause. The WC rule remains.

---

## Article 10 — Repository is the permanent source of truth

**Rule:** The Git repository is the source of truth for every fact about GroLabs. Specs, decisions, schema, code, configuration — all live in the repo, version-controlled and reviewable. Memory (Claude's stored context about Tuncho and GroLabs), conversation history, and external notes are treated as hints — useful, sometimes correct, never authoritative.

When memory and the repository disagree, Claude flags the conflict explicitly and waits for the user to confirm which is correct. Claude does not silently resolve the contradiction.

**Why non-negotiable:** Memory drifts. Conversation context is lost. The repository is the only artifact that survives every session, agent, and team change. Allowing memory to override repo means any agent could "confidently" produce work that contradicts the spec.

**Trigger to revisit:** None. This rule is permanent.

---

## Article 11 — Plugin names are functional, source-based, decoupled from marketing

**Rule:** Plugin technical names follow the pattern `[domain]-plugin` (e.g., `search-plugin`, `login-plugin`) or `[source]-plugin` when the source is the discriminating factor (e.g., `ga4-plugin` because future analytics plugins for other sources would need their own slugs). Marketing names (Insights Suite, Fastlane Checkout, etc.) live on the product wrapper, not on the plugin.

The WP directory technical slug is `grolabs-[name]-plugin`. The directory display name can change with marketing repositioning; the slug is permanent.

**Why non-negotiable:** Marketing names change every few years. WP directory slugs cannot change once published. Decoupling protects both layers.

**Trigger to revisit:** None. The pattern is stable.

---

## Article 12 — Agent capabilities are agnostic, stateless, and reusable

**Rule:** Functions in the Optimization Agent module are pure, industry-agnostic, and reusable across invocation contexts. They accept inputs and produce proposals; they do not know who called them or why. Workflow context — when to invoke an agent function, how to surface its proposals, who approves them, how to apply accepted proposals — belongs in the calling module, not in the agent function itself.

**Why non-negotiable:** This decoupling is what makes the agent reusable. The same `proposeAttributeValuesFromName` function runs during initial WC import, during scheduled background sweeps, during merchant-triggered review-all passes, and during the first-sync probe — same code, different trigger contexts. Without this decoupling, each invocation context would copy-paste the logic, drift would set in, and the agent module would entangle with every consumer.

**Implications:**
- Agent functions are testable in isolation: feed them inputs, receive proposals, verify outputs. No need to stand up other modules.
- Different invocation contexts can choose different approval workflows: auto-accept high-confidence proposals during migration; queue for review during background sweeps; show inline with one-click approve in interactive workflows. The capability does not change; the workflow does.
- The Catalog module (or Search Engine, or Sync, or any other) owns the decision of when to invoke an agent capability and how to handle the proposal. The Agent module owns the capability itself.

**Trigger to revisit:** None. This is the architectural principle that keeps the Optimization Agent reusable. Permanent.

---

## Amendment log

| Date | Article | Change | Reason |
|---|---|---|---|
| 2026-05-16 | — | Initial ratification | First constitution document |
| 2026-05-17 | Article 12 added | New article on agent capability decoupling | Emerged from search-foundations reshape Discussion |

---

**End of Constitution v1.0.**
