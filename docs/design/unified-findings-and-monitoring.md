---
application: core-app
module: Design
title: "Unified Findings & Monitoring — Architecture Exploration"
status: Draft
owner: "Tuncho"
audience: "Claude Code (future implementer), GroLabs contributors scoping the findings/monitoring layer."
scope: "The data-model design for unifying three signal sources (prospect rubric, search/cart events, GA4 traffic) into one structured store that produces reports and findings. Storage model and finding taxonomy are DECIDED; monitor scheduling, identity, and the search-events amendment are leaning/proposed and need sign-off. Covers the data model; search-proxy-event-pipeline.md owns the infra/scaling/fault-tolerance side of the same system."

actors:
  - name: Scheduled evaluator
    type: system
    definition: A single cron (leaning) reading the aggregate tables and firing all rules — the GA4 poll-then-anomaly model generalized. Monitors read aggregates; they do NOT re-scrape the storefront.
  - name: RRE search proxy
    type: system
    definition: Already logs every query to query_log with total_hits, so Search-Performed is captured without a new plugin event (zero-results = total_hits 0; results-but-no-click = a query_log row whose queryUid never appears as a click).
  - name: WP plugin
    type: plugin
    definition: Mints a per-browser anonymous userId and dual-writes events; needs to send userId on the search POST and emit the new remove-from-cart and un-gated completed-order events.

integrations:
  - name: finding / finding_fix
    kind: internal-module
    target: Prospect rubric run layer (prospectos.md)
    direction: in
    purpose: Run-scoped, immutable findings + the uplift formula; left as-is and UNIONed into the unified view.
  - name: analytics_event
    kind: internal-module
    target: Event mirror (search-events.md, plugin v0.7.0)
    direction: both
    purpose: The store for everything to slice or stitch into journeys — un-gated, with userId + line items. Gets remove-from-cart and un-gated orders.
  - name: query_log
    kind: internal-module
    target: Search proxy log
    direction: in
    purpose: Source of Search-Performed; needs a new userId column to stitch no-results searches into journeys.
  - name: ga4_alert / ga4_*_daily
    kind: internal-module
    target: GA4 integration (ga4-integration.md)
    direction: in
    purpose: The stateful alert lifecycle and daily snapshots; ga4_alert is generalized into the new monitor_alert.

rules:
  - id: R-1
    statement: The system is a five-layer pipeline — Raw events (analytics_event, query_log) → Aggregates (rollups + ga4_*_daily) → Rules/thresholds → Findings (finding + monitor_alert) → Delivery (alert vs. summary). Generalize the shipped GA4 poll-then-anomaly pattern to all sources; don't invent a new one.
    truth: true
    rationale: §1. The pattern already ships for GA4.
  - id: R-2
    statement: 'Findings classify into three first-class classes orthogonal to severity — revenue_leak (quantifiable money lost), ux_issue (subjective conversion impediments), and value_prop (demand-side non-conversion: price/delivery/offer, the genuinely new class). The earlier quick_win class was dropped ("easy fix" is a property of the fix, not the finding).'
    truth: true
    rationale: §2 DECIDED. Severity + effort live separately.
  - id: R-3
    statement: Storage is two physical tables of opposite shape unified by a view — finding (run-scoped, immutable, exists) and monitor_alert (new, stateful firing→acknowledged→cleared, ga4_alert generalized) — UNIONed by a findings_unified view. finding_class is stored on both tables, and fixes reference a unified (source, id) identity.
    truth: true
    rationale: §3 DECIDED (Plan B + one borrow). Plan B builds on a proven pattern and leaves the live finding flow untouched (lower blast radius).
  - id: R-4
    statement: Three of the four pillars already ship — rubric findings, the analytics_event mirror, and query_log exist; net-new is only monitor_alert, finding_class on both finding tables, and the findings_unified view.
    truth: true
    rationale: §4. The new storage is small.
  - id: R-5
    statement: Routing principle — Meilisearch gets only what improves ranking (queryUid-gated); the own store (analytics_event) gets everything to slice or stitch into journeys (un-gated, with userId + line items). Remove-from-cart is a new event to analytics_event only; completed orders also get an un-gated write (the Meilisearch path stays attribution-gated).
    truth: true
    rationale: §5 verified against code. Cart value = adds − removes − purchases needs remove-from-cart.
  - id: R-6
    statement: Don't denormalize category onto events — events carry product_id; join product_id → category at rollup time (DB is source of truth, category membership shifts). Freeze category onto an event only to capture "category as it was at purchase time."
    truth: true
    rationale: §5.
  - id: R-7
    statement: query_log has no userId, so no-results searches can't yet be stitched into a journey — the fix is small (the plugin already mints an anonymous userId; send it on the search POST and add a userId column), with no Meilisearch involvement.
    truth: true
    rationale: §5 gap. Requires reusing the same userId across search + cart + order.
  - id: R-8
    statement: Monitor scheduling, identity, and the search-events.md amendment are leaning/proposed and need sign-off — one scheduled evaluator (leaning), per-browser anonymous userId sufficient for v1 (leaning), and the amendment to search-events §4/§6 plus query_log.userId (proposed, NOT authorized — do not edit that locked doc without explicit sign-off).
    truth: unverified
    rationale: §6 needs user sign-off. A forward-reference note was added to search-events.md pointing here. See [[search-events]], [[search-proxy-event-pipeline]].
  - id: R-9
    statement: Each rule carries a threshold and a delivery mode — a breach above the alert line fires a lifecycle-tracked monitor_alert; a smaller deviation rolls into a periodic summary rather than paging. Start with sane fixed defaults; merchant-configurable thresholds are deferred (GA4 doc marks this v3).
    truth: unverified
    rationale: §7. Generalizes ga4_alert's fixed top-3.

useCases:
  - id: T-1
    title: Unified read across run-scoped and continuous findings
    given: A report or dashboard needs both a diagnostic run's findings and a firing traffic-drop monitor
    when: It reads findings_unified
    then: The view UNIONs the immutable finding rows and the stateful monitor_alert rows, each already carrying its finding_class
    verifies: [R-3, R-2]
  - id: T-2
    title: No-results search stitched into a journey
    given: A shopper performs a zero-result search then later abandons a cart
    when: The plugin sends its anonymous userId on the search POST and query_log gains a userId column
    then: The no-results search can be reconstructed as part of that user's journey post-hoc, no Meilisearch involvement
    verifies: [R-7, R-5]
  - id: T-3
    title: Cart value computed from un-gated events
    given: A shopper adds, removes, and purchases items
    when: Remove-from-cart writes to analytics_event and orders are written un-gated
    then: Cart value = adds − removes − purchases is computable across all orders, not only search-attributed ones
    verifies: [R-5]
---

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
