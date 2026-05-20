# GroLabs — Backlog

**Purpose:** This document captures work that has been discussed and agreed-upon as needing to happen, but is deliberately not happening right now. Items here are not "ideas" or "maybe later" — they are commitments with a defined trigger condition that will pull them into active work.

**Lifecycle of a backlog entry:**
- `parked` — deferred indefinitely; no current trigger
- `triggered` — the trigger condition has been met; ready to move into active Discussion
- `active` — being worked; should also appear in `specs/` or wherever active work lives
- `complete` — done; kept here for history

**Adding entries:** Backlog entries are created by explicit decision in a Discussion event, not by anyone tossing in "we should also do this." Each entry has scope, trigger, and reason for deferral.

---

## Pricing parity with WooCommerce

**Status:** parked
**Created:** 2026-05-16
**Trigger to address:** Before the catalog-integration spec is written for the GroLabs↔WC sync milestone (Phase 1 priority #2).

**Scope of discussion:**

Enumerate WooCommerce's full pricing surface and decide GroLabs' position on each piece:

- Regular price, sale price, scheduled sales (date-windowed)
- Tiered / quantity-based pricing
- Role-based pricing (different prices for different customer groups)
- Currency handling (single vs. multi-currency)
- Tax classes and tax computation responsibility
- Shipping classes and how they interact with pricing
- Combo / bundle pricing
- BOGO and quantity discounts
- Coupon codes and discount systems
- Dynamic pricing plugins commonly installed alongside WC
- Wholesale / B2B pricing modes
- Pre-orders and backorder pricing

For each: decide whether GroLabs **models it natively**, **passes it through** to WC, or **explicitly ignores it** (and what that means for the merchant).

Specifically required:
- Tax handling decision (GroLabs models tax rules vs. WC remains authoritative)
- Promotional pricing decision (combos, BOGO, coupons, time-windowed)
- Currency decision (single-currency MVP vs. multi-currency from start)

**Why deferred:**
This is a deep product discussion that branches further than the constitutional work can absorb in one session. It deserves its own Discussion event with the full protocol applied. Locking it in the constitution (Article 9) without first running the discussion would risk codifying assumptions that turn out to be wrong.

**Reference:** Constitution Article 9 (parity clause)

---

## Pet-shop-specific schema cleanup

**Status:** parked
**Created:** 2026-05-16
**Trigger to address:** As one of the first specs written under the new methodology, before the catalog module stabilization work begins.

**Scope of discussion:**

A bridge table and several columns were created earlier to prove the concept of attribute-based product-customer matching for the pet-shop vertical. This violates Constitution Article 1 (industry-agnostic core). The work to do:

- Identify every table, column, or constraint that encodes pet-shop assumptions
- Write a migration to drop them cleanly
- Confirm no downstream code references them (or update if it does)
- Preserve the *concept* (attribute matching) as a future feature — agnostic, opt-in, configurable per tenant — but do not build it now

**Why deferred:**
The cleanup is mechanical work. It should be done before any new schema work is built on top of the existing structure, to avoid layering on top of debt. But it requires a proper Discussion + spec, not an ad-hoc deletion.

**Reference:** Constitution Article 1 (sub-rule)

---

## Reconciliation flow for pre-existing WC products at first sync

**Status:** parked
**Created:** 2026-05-16
**Trigger to address:** During the catalog-integration spec writing.

**Scope of discussion:**

When a merchant onboards to GroLabs and already has products in WooCommerce, the first sync needs to import them in a way that preserves their existing WC IDs. The mapping is straightforward in principle (treat the WC import as the source of identity for those products), but the discussion needs to cover:

- What if duplicate-looking products exist in WC? Do we deduplicate during import, or import as-is and let the agent suggest deduplication later?
- What if some WC products are clearly variations of one parent that's been split into simples? Same question — fix during import or after?
- How is import progress communicated to the merchant?
- What's the rollback if the import fails partway?

**Why deferred:**
Not a constitutional matter — it's a feature inside the catalog-integration spec. Flagging here so we don't lose it.

**Reference:** Constitution Article 8 (entity-to-entity mapping)

---

## Consent, privacy, and terms drafting

**Status:** parked
**Created:** 2026-05-16
**Trigger to address:** Pre-launch, before any plugin lands in the WordPress plugin directory.

**Scope of work:**

Constitution Article 4 deferred the actual drafting of:
- Consent paragraphs presented at GroLabs signup
- Privacy policy section covering what data is collected and how it is used
- Terms of service
- Dashboard UX for data-sharing revocation

This is real legal/compliance work. It will likely require external review (lawyer, privacy specialist) before being published.

**Why deferred:**
Constitution Article 4 explicitly defers compliance implementation. Drafting now would waste effort that has to be redone with actual legal review.

**Reference:** Constitution Article 4 (compliance-deferred items)

---

## Two SSO repo folders to be consolidated

**Status:** parked
**Created:** 2026-05-16
**Trigger to address:** Before the login-plugin moves to production-readiness.

**Scope of work:**

The repo currently has two folders that appear to be related to social login:
- `scout-wordpress-social-login/`
- `wp-multi-social-login/`

Tuncho has confirmed only one plugin should exist. The work:
- Review both codebases
- Determine which is current / canonical
- Either delete the obsolete one or merge any useful pieces
- Rename the surviving folder consistent with Article 11 (`grolabs-login-plugin` or similar)

**Why deferred:**
Mechanical cleanup, not a Discussion-worthy item. But it must happen before any login-plugin release.

**Reference:** Constitution Article 11

---

## Search personalization (Meilisearch re-ranking + behavioral signals)

**Status:** parked
**Created:** 2026-05-20
**Trigger to address:** After the demo ships and basic Meilisearch search (Stage 1 of `docs/policy/search-foundations.md`) is stable in production for Wazú. Specifically: when we have enough live search traffic to measure rerank lift, and when consent/privacy work (Constitution Article 4) is far enough along to capture click events legally.

**Scope of work:**

Add per-query personalization on top of the existing Meilisearch index by passing a `personalize.userContext` string on every search. The user context is built server-side in Scout from behavioral signals (search history, filter selections, clicks, add-to-cart, current cart) and declarative profile data, then sent to a reranker (Cohere Rerank 3.5 or similar).

Two phases:

- **Phase A (lightweight):** Templated `userContext` string built at query time from session + cart signals. No profile table, no LLM. Goal is to validate rerank quality and cost.
- **Phase B (profile-as-a-service):** Persistent `user_search_profile` table, LLM-summarized context refreshed on order/daily, per-instance opt-in. Only if Phase A shows measurable lift.

Phase A build steps, behavioral signal taxonomy, the "learn that color=black is preferred" inference pattern, and the open product questions (session-scoped vs. user-scoped memory, reranker choice, plan tier) are all documented in `docs/research/search-personalization.md`.

**Why deferred:**

Not a demo priority. The basic search foundation (Stage 1) has to be solid first, and there are upstream dependencies (click-event capture in the WP plugin, consent paragraphs from Article 4) that aren't ready. Capturing this now so the research isn't redone when the trigger arrives.

**Reference:** `docs/research/search-personalization.md`, `docs/policy/search-foundations.md`, Constitution Article 4

---

**End of backlog as of 2026-05-20.**
