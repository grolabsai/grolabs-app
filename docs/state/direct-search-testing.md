---
application: core-app
module: State
title: "Direct-to-Meilisearch search — what is tested, how, and with what data"
status: Active
owner: "Tuncho"
scope: "Test coverage and verification status for the direct-search work (Phases 1-7, 2026-11-02). Companion to docs/design/direct-meilisearch-search.md."
audience: "Anyone asking 'does this actually work yet, and how do we know?'"
---

# Direct search — testing state

Written 2026-11-02, the day Phases 1–7 landed. The design doc says what was built
and why; this says **what has actually been proven, how, and against which data** —
and, more usefully, what has not.

One theme runs through it: nearly every piece is verified **in isolation**, and the
one thing not yet verified is the **join** — a real shopper search in a real browser
travelling all the way into `query_log`. That is Gate 1's job, and it is exactly the
kind of thing that passes in pieces and fails in composition.

---

## 1. Test data inventory

Three distinct datasets. Confusing them is the main way to misread a result.

### Instance 99999 — synthetic fixtures
`tests/integration/search/fixtures.ts`. A deliberately tiny catalog with
keyword↔category mappings chosen so assertions are deterministic:

| product | lives in | purpose |
|---|---|---|
| `Magicword …` ×2 | CAT_A (90001) | keyword that exists in exactly one category |
| `Otherword …` | CAT_B (90002) | keyword in a different single category |
| `Common Item` ×2 | CAT_B + CAT_C | keyword spanning categories |
| variable product | CAT_A | one in-stock + one out-of-stock variant, for the matched-variation logic |

Origin `https://test.local`. The instance row is permanent (migration
`20260520000001`); the Meilisearch index is created and dropped per run.

### Instance 16 — the Shopify dev store (real, not mock)
`grolabs-dordvapo.myshopify.com`, Shopify's standard sample catalog. **13 products**,
mostly snowboards, synced through the app's own ingest:

- `The Complete Snowboard` — 5 variants, in stock, 699.95
- `Gift Card` — 4 variants, **out of stock**
- `The Out of Stock Snowboard` — **out of stock**, useful for the stock badge
- `Selling Plans Ski Wax` — 3 variants
- nine more single-variant snowboards, 600–2629.95

**This is what Gate 1 searches.** Two consequences worth knowing before reading any
result from it: 13 products is smaller than one page, so **pagination cannot be
exercised here at all** (T-11), and these documents carry **no `variation_summary`**,
so the variant matcher returns null for every one of them (see §7).

### Synthetic event batches
Hand-built JSON posted with curl during verification, always prefixed so they can be
found and removed: `test-*`, `fidelity-*`, `authtest-*`. **All were deleted after
use** — `event_inbox`, `query_log` and `analytics_event` were each confirmed back to
zero matching rows.

---

## 2. Module-by-module

Status is one of **PROVEN** (executed, result observed), **PARTIAL** (some paths
executed), **UNVERIFIED** (built, never run against reality).

### 2.1 Key provisioning and revocation — PROVEN
*`search_key` table, `src/lib/search/search-key.ts`, the four Meilisearch primitives.*

**How:** `tests/integration/search/search-key.test.ts` — 8 tests against **real
Meilisearch**, not a mock, on instance 99999. Run with `npm run test:integration`.

Covers: provisioning is idempotent (exactly one live row); the key is scoped to one
index and search-only; it authorises its own index and is **refused on another
instance's**; status is verified against Meilisearch rather than trusted from our row;
revocation actually stops search and is recorded; revoking twice reports rather than
fails; re-issuing produces a different key and keeps history; a key deleted in the
Meilisearch console behind our back is surfaced.

**Also proven against the real instance 16 key:** 200 on `inst_16`, **403 on
`inst_11`**. That 403 is the entire tenant boundary in direct mode, since nothing
injects an `instance_id` filter any more.

### 2.2 The storefront credential's blast radius — PROVEN
**How:** direct probes with the live public key.

| probe | result |
|---|---|
| search own index | 200 |
| search another instance's index | **403** |
| write documents | **403** |
| list keys | **403** |
| **write analytics events** | **201** ← see SEC-004 |

The last row is the finding: the public key *can* write events, so forged clicks can
skew relevance. Logged, not fixed.

### 2.3 Direct search from the browser — PROVEN (on the dev host theme)
**How:** manual, in a real storefront served by `shopify app dev`, driven through the
browser's console.

Observed: `GrolabsSearchCore.isDirect()` true on `inst_16`; a search returns 200 with
hits and a `queryUid`; the payload is trimmed to `attributesToRetrieve`; the results
block renders GroLabs cards and hides the native grid **only after** results arrive;
network shows `/indexes/inst_16/search` and `/events` and **no** `/api/v1/search`,
**no** `/api/v1/events/token`.

### 2.4 Failover — PROVEN for the breaker, UNVERIFIED for the rest
**How:** opened the circuit breaker through the test seam
(`_internal.recordStrike` ×2), reloaded, and watched the network.

Result: **zero** requests to Meilisearch, **zero** to GroLabs, native grid visible,
hide-style never injected. That is R-8, R-18 and R-20 together.

**Not run:** T-6 (slow Meilisearch inside the deadline) and T-7 (hard-down, instant
failover). Both need Meilisearch made deliberately slow or unreachable, which has not
been staged.

### 2.5 Telemetry queue — PROVEN
*`grolabs-search-core.js`, the queue.*

**How:** `npm run test:queue` in `grolabs-shopify-search` — 15 behavioural tests that
load **the real file** under Node with browser shims (localStorage, fetch, timers), so
it is the shipped code being tested, not a copy.

Covers: order preserved; `seq` monotonic from 1; every event gets an id; a flush sends
one batch with all events; the queue clears on 202; **the queue is RETAINED on a 500**;
**retained when the network throws**; a queue left by a previous page is delivered
**unprompted on the next load**; overflow caps at 200 and drops the oldest, which
leaves a `seq` gap so a storefront busy enough to overflow reports its own loss.

The two that matter are the retention ones — treating a failure as delivery is how
telemetry silently disappears.

### 2.6 Ingest endpoint — PROVEN
*`/api/v1/events`: batch, auth, rate limit.*

**How:** curl against a local dev server, with real instance rows.

| case | result |
|---|---|
| batch of 3 → 202, `accepted: 3` | ✓ |
| re-post identical batch → drains 0, counts unchanged | ✓ |
| no bearer, instance **has** a key | **403** |
| wrong bearer | **403** |
| raw key without the `Bearer` scheme | **403** |
| correct bearer | **202** |
| no bearer, instance has **no** key (legacy) | **202** |
| CORS preflight advertises `Authorization` | ✓ |

That last row is not cosmetic: without it every batch dies at the `OPTIONS`, silently,
because reporting is fire-and-forget.

### 2.7 Drainer — PROVEN
**How:** posted a batch, called `/api/v1/events/drain` with the cron secret, inspected
the destination tables.

Covers: `search_performed` → `query_log`, other kinds → `analytics_event`; wrong cron
secret → 401; **`total_hits` 3 vs `estimated_total_hits` 13** in one row, proving the
R-26 split is real and not two names for one number; **"snowboard" and "snowboards" in
one batch share an `intent_group_id`**, proving intents chain *within* a batch and not
just against history.

### 2.8 Fidelity measurement — PROVEN
**How:** posted events with a deliberate gap — `seq` 1, 2, 4 — and read the
`telemetry_fidelity` view.

Result: `delivered 3, missing 1, loss 25.0%`. The gap detection works, which is what
replaced the dual-reporting the plan originally called for.

### 2.9 Health and canary probe — PROVEN
**How:** ran `search_probe_fire()` and `search_probe_collect()` by hand, then checked
`backend_operation`.

Result: health **200**, canary on `inst_16` **200**, **7ms**. Scheduled on pg_cron
every 5 minutes. The canary uses that instance's own key, so an accidentally revoked
key surfaces as a 403 here rather than as a merchant complaint.

### 2.10 Configuration panel — UNVERIFIED
Built, typechecked, and its data layer is covered by §2.1 — but **nobody has looked at
it**. It sits behind login and no screenshot exists. The five states (live / missing /
revoked / gone / unverified) have never been seen rendered.

### 2.11 Pixel — UNVERIFIED in direct mode
The pixel now takes `meilisearch_host` + `search_key` from its settings and presents
the key when reporting. The code is parsed and typechecked; `ensureWebPixel` has not
been run with the new settings, and no checkout event has been observed in direct mode.

---

## 3. What Gate 1 still needs

| test | what it needs | blocked by |
|---|---|---|
| **T-1** | A real browser search landing in `query_log` after the drain | nothing — this is runnable now |
| **T-2** | Five-event funnel + a completed **test order** | needs you: placing an order means entering card details, which I don't do |
| **T-10** | Cold-start latency **from a shopper's region** | my 814ms/152ms figures came from a dev machine; indicative, not a pass |
| **T-11** | Pagination parity across more than one page | the dev store has 13 products; needs a real catalog |

Also open from the outage half: **T-3** (GroLabs down), **T-4/T-5** (revocation stops
a live storefront), **T-6/T-7** (slow and hard-down Meilisearch).

---

## 4. Known gaps that testing surfaced

1. **Variant pricing has never worked on Shopify.** `sync.server.ts` emits neither
   `variation_summary` nor `variants[].variation_id`, so `pickMatchedVariation`
   returns null for every product and cards always show document-level price. The
   proxy behaved identically — this is not a regression, it has simply never worked.
2. **Webhooks have never been deliverable** outside a dev session, so catalog
   freshness has always depended on someone pressing *Run full sync*.
3. **Abuse is invisible** (R-32). An attacker holding the public key never reports
   itself, so `query_log` can never show one. Only Meilisearch Cloud's billing can.
4. **Telemetry is forgeable** (SEC-003, now partially mitigated) and
   **Meilisearch-side events are forgeable** (SEC-004, open).

---

## 5. How to run what exists

```bash
# GroLabs core — key lifecycle against real Meilisearch (instance 99999)
cd web-apps/app && npm run test:integration

# Storefront telemetry queue — the real file, under Node shims
cd shopify-apps/grolabs-shopify-search && npm run test:queue
```

The browser and curl checks in §2.3–2.9 were manual and are **not** automated. Turning
them into a repeatable suite is the obvious next piece of test work, and would be worth
more than any single gate: almost every finding in §4 came from running something by
hand once.
