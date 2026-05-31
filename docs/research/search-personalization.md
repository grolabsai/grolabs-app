# Search personalization — implementation research

**Status:** Research notes — not policy
**Created:** 2026-05-20
**Scope:** How to add per-search personalization on top of the Meilisearch foundation (`docs/policy/search-foundations.md`), if and when we decide to.

This document captures research done in a planning conversation. It is **not** a commitment to build, and the design decisions inside are not locked. Read the [Meilisearch personalization overview](https://www.meilisearch.com/docs/capabilities/personalization/overview) and [the personalized search guide](https://www.meilisearch.com/docs/capabilities/personalization/getting_started/personalized_search) before implementing — the API surface may have moved since these notes were taken.

---

## 1. How Meilisearch personalization actually works

Meilisearch personalization is a **per-query re-ranking layer**, not a profile store. The flow:

1. The app sends a normal search query.
2. The app attaches a `personalize.userContext` field — a **plain-English string** describing the searcher's preferences.
3. Meilisearch runs the search, then sends the top-N candidate documents + the `userContext` string to an external **reranker** (Cohere Rerank 3.5, Jina, Mixedbread AI, or a custom REST reranker).
4. The reranker scores each doc against the context string; Meilisearch returns the reordered list.

Exact API shape:

```json
POST /indexes/{index}/search
{
  "q": "wireless keyboard",
  "personalize": {
    "userContext": "The user prefers compact mechanical keyboards from Keychron or Logitech, mid-range budget, quiet keys for remote work."
  }
}
```

Hard constraints from the Meilisearch docs (as of 2026-05):

- **Affirmative statements only.** "Likes red" works; "dislikes blue" is ignored by the reranker.
- **No server-side profile storage.** Meilisearch states explicitly: *"Meilisearch does not yet provide automated generation of user profiles."* The string is supplied by the caller on every search.
- **Experimental feature.** Requires enabling the feature flag and configuring a reranker provider in index settings.
- **Provider cost is per-rerank.** Reranker fees scale with QPS, not a flat fee.
- **Cloud plan tier requirement not publicly documented.** Needs a check with Meilisearch support before committing.

## 2. Per-user vs. generic profiles — what's Meilisearch's intent?

Meilisearch is **agnostic**. `userContext` is just a string they pass to a reranker; they have no opinion on where it comes from. Looking at the demo and the e-commerce guide, all three patterns are valid:

- **Per-user persistent profile** — best signal, but the caller owns all storage and generation.
- **Session/anonymous profile** — built from the current session's clicks, filters, current cart.
- **Generic personas** — e.g., "budget-conscious dog owner buying for a senior dog" picked from a small set based on a few signals.

The Meilisearch demo uses **editable generic personas** (toggle "Thriller & Crime"), which means their reference implementation is closer to the generic end. The product page is explicit: *"Construct preferences from purchases, views, explicit selections. **Your logic.**"*

## 3. Two implementation options

### Option A — Lightweight (days, recommended starting point)

1. Enable the experimental flag + configure a reranker (Cohere or Jina) on the Meilisearch index.
2. Derive a `userContext` string **at query time** from cheap signals already available:
   - Current cart contents (species, life stage, brands)
   - Recent search/click history from this session (RRE already logs searches via the request-log panel — PR #108/109)
   - Profile fields the user explicitly set (pet species, weight, etc.)
3. Concatenate into a templated sentence: *"User shops for [species], [life stage], prefers brands [X, Y], price-sensitive."*
4. Pass on every `/search` call.

This matches Meilisearch's own demo and product copy. No background jobs, no LLM in the loop, no profile table.

### Option B — Profile-as-a-service (weeks, deferred)

1. Add a `user_search_profile` table keyed by `(instance_id, user_id)` storing the generated context string + a versioned event log.
2. Background job summarizes each user's orders/clicks/searches into a profile string via LLM (Claude/Cohere/OpenAI). Refresh on order-placed and on a daily cadence.
3. Server action attaches the cached string to each query; fallback to a generic persona for anonymous users.
4. Per-instance toggle in `integrations_config` (LLM cost is non-trivial; not every tenant will want it).

This is what a "real" personalization product looks like — closer to what Algolia NeuralSearch / Pinecone do under the hood. Meilisearch leaves all of it to the caller.

**Recommendation:** Start with Option A using session-only signals + cart contents, no LLM, templated string. It validates the rerank quality and the Cohere cost curve before committing to a profile table. Promote to Option B only if A's lift is clearly measurable.

## 4. Where the signals come from for Option A

Two categories: **what the user does** (behavioral) and **what the user is** (declarative). Behavioral is the gold mine because users don't fill out preference forms — they click.

### Behavioral signals

| Signal | Where it lives today | Effort to capture |
|---|---|---|
| Search queries | RRE request-log (PR #108/109) | None — already captured |
| Filter selections (price range, brand chip, category) | Search params, already in request payload | None — parse from existing logs |
| Result clicks | WP plugin doesn't track yet | Medium — `POST /api/search-events` endpoint + plugin instrumentation |
| Add-to-cart from search | WC hook `woocommerce_add_to_cart` | Medium — plugin sends event |
| Product page views | WC hook on `template_redirect` | Medium — plugin sends event |
| Past orders | WC database | Larger — needs a sync, not just an event |
| Time-on-page / scroll depth | Nowhere | High — usually not worth it |

The first four are the meaningful ones. Search + filters are already captured; click and add-to-cart need a small WP plugin addition that POSTs `{user_id_or_session, product_id, event_type, timestamp}` back to RRE.

### Declarative signals

- Logged-in user's profile attributes (Wazú: pet species, breed, life stage). Schema is already built — see `docs/policy/instance-management.md` and the catalog policy's profile attribute references.
- Explicit "tell us what you like" prompts on first visit. Usually low completion, but high quality for the few who answer.

## 5. Inferring preferences from behavior (the "user prefers black" case)

This is the pattern that makes Option A worth doing over a static cart-only context. Recipe:

1. **Capture clicks with product context.** When a click event lands, look up the clicked product's attribute values (color=black, brand=Keychron, price_band=mid) — RRE already has these in `product_attribute_value`. Store the attribute *values*, not just the product ID.

2. **Aggregate per session (or per user).** Keep a rolling window — last N events, or last X minutes. A simple `search_event` table keyed by `(instance_id, session_id, user_id_nullable)` with a JSONB `attributes` column is enough; no profile table required.

3. **Detect repetition above a threshold.** If ≥3 of the last 10 product interactions share `color = black`, that's a preference signal. Same logic for brand, price band, size, etc. Threshold is a tuning knob, not an architecture decision.

4. **Inject into `userContext` at query time.** Compose a sentence from detected signals: *"User has shown interest in black products and the Keychron brand. Current cart contains [items]. Pet species: dog, life stage: senior."*

The inference runs server-side in RRE in a few ms — it's aggregation over a small recent-events table, no LLM needed for the "learn black is preferred" step. The LLM only matters if we want to *summarize* a long history into a paragraph, which we don't need for Option A.

## 6. Build order when we pick this up

1. **Add the events table + endpoint in RRE.** `search_event(instance_id, session_id, user_id, event_type, product_id, attributes_snapshot, created_at)`. RLS by `instance_id`. Rolling cleanup job (drop events older than 30 days).
2. **Add click + add-to-cart tracking in the WP plugin.** Two new event types POSTed to RRE. Reuse the auth path already in place for search.
3. **Build a `buildUserContext(sessionId, userId, cart)` helper in RRE** that reads recent events, detects repeated attribute values above threshold, returns the templated string. Pure logic, no external dependencies, easy to unit-test.
4. **Pass the string into Meilisearch** on every search.
5. **A/B against an empty `userContext`** to measure lift before investing in Option B.

## 7. Open questions to resolve before building

- **Cloud plan tier required for personalization** — needs a check with Meilisearch support since Wazú's Meilisearch Cloud is the production index.
- **Reranker provider + cost model** — Cohere Rerank 3.5 vs. Jina vs. Mixedbread; cost per rerank at Wazú's search QPS.
- **Experimental flag in production** — acceptable on Wazú now, or wait for GA?
- **Session-scoped vs. user-scoped memory** — for logged-in users, do preferences persist across sessions, or expire with each session? This is the only real product call to make before building.
- **Privacy / consent** — capturing click events ties to Constitution Article 4 (consent + privacy). Resolve before the WP plugin ships event tracking.

## 8. Sources

- [Personalization overview](https://www.meilisearch.com/docs/capabilities/personalization/overview)
- [Performing personalized search queries](https://www.meilisearch.com/docs/capabilities/personalization/getting_started/personalized_search)
- [Personalized search demo](https://www.meilisearch.com/docs/resources/demos/personalized_search)
- [Personalization product page](https://www.meilisearch.com/products/personalization)
- [Meilisearch roadmap](https://www.meilisearch.com/roadmap) (Q2 2026 pricing tiers, Q3 2026 serverless)
