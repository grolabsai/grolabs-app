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

## Amendment log

| Date | Article | Change | Reason |
|---|---|---|---|
| 2026-05-16 | — | Initial ratification | First constitution document |

---

**End of Constitution v1.0.**
