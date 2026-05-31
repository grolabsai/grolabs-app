# Unified Findings & Monitoring — Architecture Exploration

Status: **Exploration.** Storage model + taxonomy DECIDED; several items LEANING/PROPOSED (see §6). No code written yet.
Owner: Tuncho
Date: 2026-05-29
Audience: Claude Code (future implementer), GroLabs contributors scoping the findings/monitoring layer.

> **Why this doc exists.** We have three separate signal sources today — the prospect
> diagnostic rubric, search/cart events, and GA4 traffic — and we want them to feed **one
> structured store that produces unified reports and findings**. This captures the design
> discussion so a future session can pick it up without re-deriving it. Pairs with
> [`search-proxy-event-pipeline.md`](search-proxy-event-pipeline.md), which covers the
> **infra/scaling/fault-tolerance** side of the same system; this doc covers the **data model**.

---

## 1. The five-layer model

```
Raw events  →  Aggregates  →  Rules / thresholds  →  Findings  →  Delivery
(analytics_     (rollups +      (evaluate breach     (finding +    (alert vs.
 event,          ga4_*_daily)    conditions)          monitor_      summary)
 query_log)                                           alert)
```

This mirrors the GA4 **poll-then-anomaly** pattern that already ships (`ga4-integration.md`):
pull/store inputs on a schedule → evaluate rules against the stored window → write findings →
deliver. Generalize that pattern to all sources, don't invent a new one.

## 2. Finding classification — DECIDED

Three classes, stored as a first-class enum, **orthogonal to a separate `severity`**:

| `finding_class` | Meaning |
|---|---|
| `revenue_leak` | Quantifiable money lost (the prospectos uplift formula already computes this). |
| `ux_issue` | Subjective / experience problems that impede conversion. |
| `value_prop` | **Demand-side** non-conversion — price too high, delivery too slow, the offer itself. Not a site bug; the value proposition is the problem. This is the genuinely new class. |

> Earlier drafts had a 4th class (`quick_win`). **Dropped** — "easy fix" is a property of the
> *fix*, not the finding. Severity + effort live separately.

## 3. Storage model — DECIDED (Plan B + one borrow)

Two physical tables with **opposite shapes**, unified by a view:

- **`finding`** (already exists, per `prospectos.md`) — **run-scoped, immutable**: describes what was
  true at one diagnostic run. Left as-is.
- **`monitor_alert`** (new) — **stateful**: `firing → acknowledged → cleared`. This is
  `ga4_alert` (from `ga4-integration.md`) **generalized** to any rule/source. Threshold monitors
  (traffic drop, no-results spike, cart-abandon rate) are stateful and span days — they need this
  shape, not the immutable one.
- **`findings_unified`** (view) — `UNION`s both for every report/dashboard read.

**Borrowed from the rejected Plan A (one polymorphic table):**
1. `finding_class` is **stored on both tables** (not computed in the view) so each row classifies
   itself at write time.
2. Fixes reference a **unified `(source, id)` identity**, not only `finding.id`, so a monitor alert
   can carry a `finding_fix` too — avoids a duplicate join table later.

**Why Plan B over Plan A:** run-scoped and continuous data genuinely differ; Plan A's `incident`
layer existed only to bolt statefulness onto an immutable table, re-inventing what `ga4_alert`
already does. Plan B builds on a proven, shipped pattern and leaves the live `finding` flow
untouched (lower blast radius). Full pros/cons were weighed in conversation; this is the conclusion.

## 4. What already exists vs. what's net-new

**Three of the four pillars already ship** — the new storage is small:

| Layer | Status |
|---|---|
| Rubric findings (`finding`, `finding_fix`) | Exists (`prospectos.md`) |
| Event mirror (`analytics_event`) | Exists (`search-events.md`, plugin v0.7.0) |
| Search log (`query_log`) | Exists — the search **proxy** logs every query |
| GA4 daily snapshots + `ga4_alert` | Exists (`ga4-integration.md`) |
| **`monitor_alert`** (generalize `ga4_alert`) | **New** |
| **`finding_class`** on both finding tables | **New** |
| **`findings_unified`** view | **New** |

## 5. Event taxonomy — facts & gaps (verified against code)

- **Search-Performed is ALREADY captured.** RRE is a full query **proxy** (`/api/v1/search`),
  not just a token broker. It logs every query to `query_log` with `total_hits`. **Zero-results =
  `total_hits = 0`**; results-but-no-click = a `query_log` row whose `queryUid` never appears as a
  click in `analytics_event`. **No new plugin event needed for search.**
- **Gap: `query_log` has no `userId`.** So no-results searches can't yet be stitched into a user's
  journey. Fix is small: the plugin already mints an anonymous `userId`; send it on the search POST
  and add a `userId` column to `query_log`. No Meilisearch involvement.
- **Remove-from-cart — NEW event → `analytics_event` ONLY.** It has no place in Meilisearch's
  search→click→conversion funnel and no `queryUid` meaning. Needed so cart value =
  `adds − removes − purchases`.
- **Completed order — exists but search-gated.** Today it dual-writes only when there's a `queryUid`
  attribution ("no attribution → no event"). For full journey + slice-by-category across *all*
  orders, add an **un-gated** write of every order to `analytics_event` (Meilisearch path stays
  gated — it only wants attributed conversions).
- **Don't denormalize category onto events.** Events carry `product_id`; join
  `product_id → category` at **rollup time** (DB is source of truth, category membership shifts).
  Freeze category onto the event only if you explicitly want "category as it was at purchase time."

**Routing principle:** Meilisearch gets what improves ranking (queryUid-gated). Our store
(`analytics_event`) gets everything we want to slice or stitch into journeys (un-gated, with
`userId` + line items).

## 6. Open / leaning / proposed — NEEDS USER SIGN-OFF

- **Monitor scheduling (LEANING).** One scheduled evaluator — a single cron reading the aggregate
  tables and firing all rules (the GA4 poll-then-anomaly model) — rather than per-rule jobs or
  piggybacking on diagnostic runs. Monitors read aggregates; they do **not** re-scrape the
  storefront.
- **Identity (LEANING).** Per-browser anonymous `userId` is sufficient for v1 post-hoc journey
  reconstruction (no cross-device; clearing the browser = new identity). Add a session id only if
  within-day journey splitting becomes necessary. Requires reusing the **same** `userId` across
  search + cart + order so journeys stitch.
- **`search-events.md` amendment (PROPOSED — not authorized).** This work contradicts that locked
  policy's non-goals and must amend it: §4 (best-effort/loss-acceptable no longer holds once events
  feed revenue → durable buffer, see the proxy doc), §6 ("no aggregation API on RRE" — we *will*
  roll up), plus the new events and `query_log.userId`. **Do not edit that doc without explicit
  sign-off.** A forward-reference note has been added there pointing here.
- **Separate proxy/ingest service** — see `search-proxy-event-pipeline.md` §6.

## 7. Thresholds → alert vs. summary

Each rule carries a threshold and a delivery mode (generalizing `ga4_alert`'s fixed top-3):
a breach above the "alert" line fires a `monitor_alert` (surfaced, lifecycle-tracked); a smaller
deviation rolls into a periodic **summary** rather than paging. Merchant-configurable thresholds
are deferred (GA4 doc marks this v3); start with sane fixed defaults.

## 8. Related docs (read before building)

- [`search-proxy-event-pipeline.md`](search-proxy-event-pipeline.md) — infra/scaling/fault-tolerance
  for the proxy + event ingest (the durable buffer that makes events loss-free enough to feed
  revenue findings).
- `docs/policy/prospectos.md` — the existing `finding` / `finding_fix` run layer + uplift formula.
- `docs/policy/ga4-integration.md` — `ga4_alert` lifecycle being generalized into `monitor_alert`;
  the poll-then-anomaly pattern.
- `docs/policy/search-events.md` — current event flow (+ the pending-amendment note pointing here).
