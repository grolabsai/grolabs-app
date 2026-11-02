---
application: core-app
module: Design
title: "Direct-to-Meilisearch Search — implementation plan"
status: Draft
owner: "Tuncho"
audience: "Claude Code (implementer), GroLabs contributors reviewing the change before it ships to a storefront."
scope: "The plan to take GroLabs out of the storefront search request path entirely: each instance gets one permanent, non-expiring, search-only Meilisearch API key, configured once into the storefront, and search telemetry is reported back asynchronously. Covers the key's lifecycle and manual revocation, the storefront changes, the ingest/drain pipeline, the guardrails that must move, and the two test gates (positive path, then outage path). Executes the direct-connect option that search-proxy-event-pipeline.md §6 left open."

actors:
  - name: Storefront client
    type: system
    definition: The Shopify theme-extension JS that today POSTs every search to GroLabs /api/v1/search and will instead query Meilisearch directly with a key held in its own block settings.
  - name: Drainer
    type: system
    definition: A pg_cron job that reads event_inbox in batches and writes query_log + analytics_event + rollups, then marks rows processed. Same mechanism as blog + GA4 polling.
  - name: Shopper
    type: human
    definition: Needs results now. Must keep getting them while GroLabs is down.
  - name: Operator
    type: human
    definition: GroLabs staff cutting off a churned instance by hand — one named key, deleted in the Meilisearch console.

integrations:
  - name: Meilisearch
    kind: external-service
    target: Storefront client (direct), key provisioning
    direction: both
    purpose: Becomes the storefront's direct search backend and its direct event sink. Also the whole enforcement surface — DELETE /keys/{uid} on an instance's key is the cutoff.
  - name: Cloudflare (or equivalent WAF)
    kind: external-service
    target: Meilisearch host
    direction: in
    purpose: Replaces the proxy's rate limiter. Must be live BEFORE storefront traffic moves — the key is permanent and public, so there is no expiry backstop on abuse.
  - name: PostHog
    kind: external-service
    target: Drainer
    direction: out
    purpose: "Search Performed" forwarding moves from the search route to the drainer. Same event, later.

rules:
  - id: R-1
    statement: Search leaves the GroLabs request path entirely — the storefront queries Meilisearch directly. This is what buys both the latency win (~200ms of proxy + 3-4 Postgres round-trips removed) and independence from GroLabs availability; a faster proxy (edge, no DB) was considered and rejected because a hop is still a hop and still ours to break.
    truth: true
    rationale: Decided 2026-11-02. Supersedes the undecided option (b)/(c) framing in search-proxy-event-pipeline.md §6.
  - id: R-2
    statement: "The storefront credential never expires and is never renewed. Availability is the priority; automatic payment enforcement is explicitly NOT a goal. There is no refresher job, no TTL, no refresh-on-render, no synchronous re-mint — nothing GroLabs runs on a schedule can break a merchant's search."
    truth: true
    rationale: Decided 2026-11-02, replacing the earlier 7-day/daily-refresh design. Any renewal mechanism is a recurring failure mode in exchange for enforcement we do not want; at well under 100 tenants the manual alternative costs nothing.
  - id: R-3
    statement: Meilisearch has no tenant-token API — tokens are JWTs signed locally from a parent key, cannot be listed, and cannot be revoked individually. API keys DO have full CRUD (POST/GET/PATCH/DELETE /keys), so a permanent credential must be an API key, not a tenant token.
    truth: true
    rationale: Verified against meilisearch-client.ts (generateTenantToken is local signing; getOrCreateParentKey already calls getKeys/createKey) and the SDK surface, v0.58.
  - id: R-4
    statement: "Each instance gets ONE permanent search-only API key — actions [\"search\"], indexes [\"inst_N\"], expiresAt null, named grolabs-inst-N. Index-per-instance already isolates tenants, so the tenant token's instance_id = N filter is redundant; dropping tenant tokens for the storefront removes the parent-key indirection, the signing step and the expiry together."
    truth: true
    rationale: Follows from R-2 + R-3. A named key is also visible in the Meilisearch console, which is what makes manual cutoff a real operation rather than a thing only code can do.
  - id: R-5
    statement: One key covers BOTH direct search and direct event submission — Meilisearch's /events endpoint takes a search-scoped key (EVENTS_KEY_ACTION is "search"). So the same credential retires /api/v1/search/token AND /api/v1/events/token, removing the last per-page-load GroLabs call from the storefront.
    truth: true
    rationale: Verified at meilisearch-client.ts:104. The pixel and events.js currently fetch an events token on every page; that round-trip disappears.
  - id: R-6
    statement: The key is stored per instance in Postgres (search_key) and looked up directly, never discovered by listing. client.getKeys({ limit 100 }) silently breaks past 100 tenants.
    truth: true
    rationale: The current shared-parent-key code discovers by name through a listing; per-instance keys make that a correctness bug waiting on tenant count.
  - id: R-7
    statement: The key reaches the storefront once, as configuration — a Shopify theme-extension block setting — alongside the instance_id and api_host already configured there. No metafield, no Admin API scope, no merchant re-authorization, no browser fetch.
    truth: true
    rationale: Decided 2026-11-02. A credential that never changes needs no delivery mechanism beyond the one-time setup the merchant already performs for the embed.
  - id: R-8
    statement: "The storefront NEVER calls /api/v1/search. No failure class routes back to GroLabs — every one of them ends at the platform's own search, exactly as if our app were not installed. This keeps the shopper's path free of GroLabs even when things break, and it is what makes the manual cutoff real: a proxy fallback would silently restore a revoked merchant's search."
    truth: true
    rationale: Decided 2026-11-02 — the shopper-path fallback is local-only. Also collapses failover to a single destination, so there is never a question of which backend answered.
  - id: R-9
    statement: Manual enforcement must be visible to be real — search_key rows carry revoked_at, the admin surface shows key status per instance, and offboarding has an explicit "delete the Meilisearch key" step in the runbook. A forgotten key means a churned merchant searching forever.
    truth: true
    rationale: Decided 2026-11-02. Consistent with Constitution Art. 7 (model it, don't enforce it) — but a model nobody can see is not a model.
  - id: R-10
    statement: Search telemetry is accept-fast/process-async — batched POST to /api/v1/events, append to event_inbox, return 202; the drainer writes query_log + analytics_event + rollups and forwards to PostHog. A GroLabs outage makes telemetry lag, never lost, provided the client retries.
    truth: unverified
    rationale: The pattern from search-proxy-event-pipeline.md §3 (its R-4/R-5), now required rather than proposed. Not built yet.
  - id: R-11
    statement: /api/v1/search is NOT deleted, but it is no longer a storefront fallback (R-8). It survives as the ingest host, as back-compat for existing integrations and the BYO SDK, and as the Gate 1 "before" latency baseline.
    truth: true
    rationale: Decided 2026-11-02. A proxy fallback was in the plan until the shopper-path fallback was settled as local-only — and it was weak anyway, since the proxy talks to the same Meilisearch.
  - id: R-12
    statement: "Shopify is the only storefront platform in scope. WordPress search is dropped — if GroLabs ever returns to WordPress it will be catalog management only, nothing touching search. The wp-plugins/grolabs-wordpress-search repo is frozen, not pending parity. Instance 16 (GroLabs.io, dev store grolabs-dordvapo) is the test target."
    truth: true
    rationale: Decided 2026-11-02. Consistent with the live tenant map anyway — HPC/instance 11 is a Medusa+Algolia customer and the WP test instances (12, 13, 15) were deleted 2026-07-31, so no WP storefront existed to carry this.
  - id: R-13
    statement: "All storefront telemetry is browser-batched with a localStorage retry queue, because on Shopify there is no merchant server GroLabs can run code on — a theme app extension is liquid + JS only. With WordPress out of scope (R-12) there is no server-buffered path anywhere in the design, so browser-batched is not a compromise against a better option; it is the only option, and R-14's measurement is the only thing standing between us and unknown data loss."
    truth: true
    rationale: Decided 2026-11-02. The earlier plan leaned on a WP server-side buffer for high-fidelity committed searches; dropping WordPress removes that lever entirely.
  - id: R-14
    statement: Fidelity must be measured, not assumed — during rollout the storefront reports each committed search by both paths, and the delta is that instance's browser-loss ratio.
    truth: unverified
    rationale: Direct mode turns server-observed truth into client-reported telemetry. query_log is complete today; the replacement's loss rate is unknown until measured.
  - id: R-15
    statement: Rate limiting moves to a WAF in front of the Meilisearch host and must be live before any storefront traffic moves. The proxy's rate limiter is currently the only cap between a looping storefront and the shared cluster, and a permanent key has no expiry to bound abuse.
    truth: unverified
    rationale: search-proxy-event-pipeline.md §5 — the cost/runaway guardrail. Not yet built anywhere.

  - id: R-16
    statement: "The deadline is a latency budget, not a death detector — 1000ms for typeahead, 2500ms for a committed/results-page search, measured from request start. Meilisearch's own processing time is p50 6ms / p99 13ms / max 18ms across 574 logged searches, so a 5-second timeout would be ~270x the slowest response ever observed, and would make a slow incident WORSE than an outage: the shopper waits the full deadline and only then waits for the native search to run."
    truth: true
    rationale: Measured 2026-11-02 from query_log (instances 16 + 99999, status 200). Browser-observed latency adds network RTT + TLS handshake on top of those 6ms, which is what the budget is sized for — not for Meilisearch being slow, which it never has been.
  - id: R-17
    statement: A hard-down Meilisearch needs no timeout at all — DNS failure and connection-refused return in milliseconds, so failover is instant and free. The deadline governs only the SLOW case, which is exactly where a long deadline does the most damage.
    truth: true
    rationale: "Follows from R-16. \"How do we know it died\" and \"how do we know it is too slow\" are different questions; only the second one needs a clock."
  - id: R-18
    statement: "Failover is per error class, and a client-side circuit breaker stops the storefront paying the deadline over and over: network error / timeout / 5xx fail over and count toward the breaker (2 consecutive failures = skip Meilisearch for 60s, held in sessionStorage); 429 fails over and backs off without tripping the breaker; 403 is a revoked key — degrade for the rest of the session and never retry. No class ever calls GroLabs (R-8); the error class decides only whether and when to try Meilisearch again."
    truth: true
    rationale: Without the breaker, every keystroke during an incident pays the full deadline. Without the error-class split, a WAF throttle or a deliberate cutoff gets misread as an outage.
  - id: R-19
    statement: The storefront NEVER pre-flights /health. A health check before each search doubles the latency this whole plan exists to remove, and a healthy probe does not mean the next query succeeds. GroLabs detects Meilisearch trouble two other ways instead — a pg_cron probe (health + canary search per index, into backend_operation) and the search_failed records the telemetry batch already carries, with their error class.
    truth: true
    rationale: Decided 2026-11-02. Shopper-observed failure counts are better alerting than a synthetic probe anyway; the probe exists to catch an outage with no traffic to observe it.
  - id: R-20
    statement: "Our storefront code is strictly ADDITIVE and fails by doing nothing. We never EMULATE native search — calling /search/suggest.json ourselves and rendering it in our own dropdown is not \"as if the app were not installed\"; we step aside and let the theme's own search behave. On Shopify the native results are already server-rendered on /search?q= before our JS runs, so the results-page fallback is literally a no-op. The typeahead therefore suppresses the theme's own dropdown ONLY once our hits have arrived, never at init — otherwise stepping aside mid-session leaves the shopper with neither."
    truth: true
    rationale: Decided 2026-11-02. Hiding the native listing before results arrive was a live bug through plugin v0.5.x-v0.6.3 — see the is_search_results guard in class-grolabs-wordpress-search-typeahead.php. A fallback is worthless if our own suppression already emptied the page.
  - id: R-21
    statement: "The theme block must emit <link rel=\"preconnect\"> (plus dns-prefetch as fallback) for the Meilisearch origin, so DNS + TLS complete during page load rather than on the shopper's first keystroke. This is the one place direct mode can be SLOWER than the proxy: Vercel terminates TLS at an edge POP near the shopper and then reaches Meilisearch over a warm pooled connection, whereas the browser must handshake (2 RTTs) directly with a region-pinned Meilisearch project. Confirm the project's region against where the merchant's shoppers actually are."
    truth: true
    rationale: "Identified 2026-11-02. Warm requests are unambiguously faster; the cold first request is the exception, and preconnect is the standard remedy. Region now VERIFIED: the Meilisearch project is in **sfo** (San Francisco). For a Guatemalan shopper that is roughly 60-90ms of RTT, so a cold TLS handshake costs ~150-250ms before the 6ms query -- squarely in the range where the first search could lose to the proxy it replaces. Preconnect is not optional."
  - id: R-22
    statement: "Direct search MUST set attributesToRetrieve, keeping only the fields the UI renders plus variants (the matcher needs them). Today the proxy consumes _matchesPosition server-side and drops it; sending it to the browser instead adds bytes per hit per keystroke. Untrimmed, payload gets worse than today; trimmed, it gets better — the proxy already ships whole documents, description included."
    truth: true
    rationale: Verified 2026-11-02 — attributesToRetrieve appears nowhere in src/lib/search, and showMatchesPosition is unconditionally true. Direct mode is the moment to fix a cost we have simply been absorbing.
  - id: R-23
    statement: The storefront bundle must NOT gain the Meilisearch JS SDK — raw fetch against one endpoint. Shipping tens of KB of client to a theme app extension for a single POST is a storefront-performance regression a merchant will see in their theme score.
    truth: true
    rationale: Decided 2026-11-02. The extension is plain JS assets today and should stay that way.
  - id: R-24
    statement: "The additive fallback (R-20) introduces a content swap that does not exist today: native results render, then ours replace them. On the results page, suppress native immediately ONLY when we hold a key and the breaker is closed — i.e. when we expect to succeed — and otherwise leave native untouched; reserve the container height either way so the swap costs no CLS."
    truth: true
    rationale: Identified 2026-11-02 as a direct consequence of making the fallback local-only. The breaker state is the signal for whether to expect success, which is what lets us avoid both the flash and the empty page.
  - id: R-28
    statement: "Meilisearch does NOT enforce unique API key names -- two keys may carry the same name (verified empirically 2026-11-02: both POST /keys calls returned 201). So `grolabs-inst-N` is safe as a stable, operator-readable name. The cost is that nothing upstream prevents duplicates, and a key whose DB row was lost is invisible to the configuration panel and cannot be revoked from it."
    truth: true
    rationale: "Probed against the live project rather than assumed, because a uniqueness constraint would have forced a per-issuance suffix and weakened the \"find it by name\" property that manual revocation depends on. The orphan case is a known gap: closing it means listing keys scoped to inst_N and reconciling, which R-6 bars from the lookup path but would be fine as an explicit reconciliation action."
  - id: R-25
    statement: "Pagination is native to Meilisearch and nothing about it depended on the proxy — the browser passes the same parameters. But the two modes are a choice: offset/limit (today's) returns estimatedTotalHits, an ESTIMATE, which suits typeahead and load-more but cannot drive numbered pages; page/hitsPerPage returns exact totalHits + totalPages at the cost of a slower, exhaustive count. The index setting pagination.maxTotalHits defaults to 1000 and caps BOTH how deep a shopper can page and the number reported back."
    truth: true
    rationale: Verified against searchInstance + the route, which pass limit/offset and return raw.estimatedTotalHits. The mode has never been an explicit decision because the storefront has only ever shown a dropdown and one results page.
  - id: R-26
    statement: "query_log.total_hits stores the RETURNED PAGE LENGTH (hits.length), not the result total — while the API response returns estimatedTotalHits to the caller under the same name. Zero-result detection is unaffected (0 is 0, whichever number it is), but any \"how many results did this query have\" reading is capped at the page size. Direct mode must pin this deliberately: keep total_hits meaning page length for series continuity and add estimated_total_hits alongside, or the KPI series silently changes meaning mid-migration."
    truth: true
    rationale: "Verified 2026-11-02 at the logRequest insert (total_hits: input.hits?.length) against the response builder (total_hits: raw.estimatedTotalHits). Latent rather than manifested: across 574 logged searches the maximum total_hits is 12, because the test catalogs are small enough that no query has ever matched more than its page size. A real catalog would log 20 for a 500-match query."
  - id: R-27
    statement: The proxy clamped limit to 1..100 and offset to >= 0. Direct mode has no such clamp — a client may ask for any page size — so pagination.maxTotalHits plus the WAF are the only remaining guards on page depth and response size.
    truth: true
    rationale: Follows from removing the proxy. Low severity (the catalog is public data) but it is a guard that silently disappears, and large page sizes are a cheap way to load the shared cluster.

useCases:
  - id: T-1
    title: "Gate 1 — positive path"
    given: Instance 16's storefront is running the direct-search build with its permanent key in the block settings
    when: A shopper types a query and opens the results page
    then: Results come back from Meilisearch with no GroLabs hop, measured latency drops, and after the drain every search appears in query_log with the same fields the proxy wrote (total_hits, processing_time_ms, query_uid, user_id, committed)
    verifies: [R-1, R-7, R-10]
  - id: T-2
    title: "Gate 1 — funnel still attributes, with no token fetch"
    given: The five-event funnel verified on instance 16 on 2026-07-31
    when: A shopper searches, clicks a result, adds to cart, checks out and completes an order
    then: Every event still stitches to its search by queryUid, end to end, with a test order as proof — and the network log shows zero calls to any GroLabs token endpoint
    verifies: [R-5, R-10]
  - id: T-3
    title: "Gate 2 — outage path"
    given: Gate 1 is green and GroLabs services are deliberately taken down
    when: A shopper searches during the outage, and GroLabs is restored afterwards
    then: Search works throughout, telemetry queues client-side, and on recovery the queue flushes so query_log shows the outage-window searches with no loss
    verifies: [R-1, R-2, R-10]
  - id: T-4
    title: Operator cuts off a churned instance
    given: An instance whose storefront is searching on its permanent key
    when: The operator deletes the key named grolabs-inst-N in the Meilisearch console
    then: That storefront stops returning results within seconds, every other instance is unaffected, the catalog index is untouched, and reactivation is one new key pasted into the storefront config
    verifies: [R-3, R-4]
  - id: T-5
    title: Revoked key falls back to native with no GroLabs call
    given: An instance whose key has been deleted
    when: Its storefront searches and Meilisearch answers 403
    then: The shopper sees the platform's own search results, and the network log shows no call to any GroLabs endpoint — the cutoff holds
    verifies: [R-8]
  - id: T-9
    title: Stepping aside leaves the theme's own search working
    given: The breaker is open, or Meilisearch answered 403
    when: A shopper types in the search box and submits
    then: The theme's own predictive dropdown and its /search?q= results behave exactly as they do with the app uninstalled — our suppression never fired, because it only fires once our hits arrive
    verifies: [R-20]
  - id: T-11
    title: Pagination parity and an unambiguous hit count
    given: A query matching far more products than one page
    when: The shopper pages through results and the search is drained into query_log
    then: Paging behaves exactly as it does through the proxy today, and the row carries both the page length and the result total in separate fields, with neither standing in for the other
    verifies: [R-25, R-26]
  - id: T-10
    title: "Gate 1 — cold first search is not a regression"
    given: A shopper session with no warm connection to the Meilisearch origin
    when: They type their first query
    then: Time-to-results for search #1 is at or below today's proxy p50, with preconnect in place, and warm searches land far below it — measured from the shopper's region, not from a developer machine
    verifies: [R-21]
  - id: T-6
    title: Slow Meilisearch fails over inside the budget
    given: Meilisearch is reachable but answering slower than the deadline
    when: A shopper searches
    then: The request is abandoned at 1000ms (typeahead) or 2500ms (results page) and native search answers, with the abandonment reported as a search_failed record carrying error class "timeout"
    verifies: [R-16, R-18]
  - id: T-7
    title: Hard-down Meilisearch fails over instantly
    given: The Meilisearch host is unresolvable or refusing connections
    when: A shopper searches
    then: Failover happens in milliseconds without waiting any deadline, and the shopper sees native results with no perceptible stall
    verifies: [R-17]
  - id: T-8
    title: Breaker stops repeated deadline waits
    given: Two consecutive searches have timed out
    when: The shopper keeps typing
    then: Further searches skip Meilisearch entirely for 60s and go straight to native, so no keystroke pays the deadline again
    verifies: [R-18]
---

# Direct-to-Meilisearch Search — implementation plan

**Decided 2026-11-02.** Owner: Tuncho. Executes the direct-connect option that
`search-proxy-event-pipeline.md` §6 left open, and answers its "separate service vs
in-app" question sideways: the search path has no GroLabs service in it at all, and
what remains in-app is ingest.

> **The shape of the decision.** Uptime beats enforcement. One permanent, non-expiring,
> search-only key per instance, configured once into the storefront. Nothing GroLabs
> runs on a schedule can take a merchant's search down, because GroLabs runs nothing in
> that path. If a merchant stops paying, an operator deletes their key by hand. At well
> under 100 tenants that is cheaper than any mechanism that could fail on its own.

## Flow

```mermaid
flowchart TB
  subgraph setup["Once, at instance setup"]
    PROV["GroLabs provisions key<br/>actions: search · indexes: inst_N · expiresAt: null"] -->|"POST /keys"| MS1["Meilisearch"]
    PROV -->|"store"| SK[("search_key")]
    PROV -->|"paste into block / plugin settings"| CFG["Storefront config"]
  end

  subgraph shopper["Shopper's path — no GroLabs hop, ever"]
    CFG --> SC["Storefront client"]
    SC -->|"POST /indexes/inst_N/search + Bearer key"| MS2["Meilisearch"]
    MS2 -->|"hits + queryUid"| SC
    SC -->|"POST /events + same key"| MS2
  end

  subgraph report["Reporting — lag-tolerant"]
    SC -->|"batched, idempotent, retried"| ING["POST /api/v1/events (GroLabs)"]
    ING -->|"202"| EI[("event_inbox")]
    EI --> DR["Drainer (pg_cron)"]
    DR --> QL[("query_log")]
    DR --> AE[("analytics_event")]
    DR --> PH["PostHog"]
  end

  SC -.->|"ANY failure → platform's own search, no GroLabs call"| NAT["Native storefront search<br/>(as if the app were not installed)"]
  OP["Operator"] -.->|"DELETE /keys/{uid} by hand"| MS2
```

## Failover — how we decide Meilisearch is not answering

**Measured 2026-11-02 from `query_log`** (574 successful searches, instances 16 + 99999):

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Meilisearch processing time | 6ms | 8–13ms | 10–13ms | **18ms** |

**5 seconds is the wrong order of magnitude** for a deadline: Meilisearch's slowest
response in 574 searches was 18ms, so 5s is ~270x the worst case ever observed.

(The retired proxy's own round-trip over the same searches — `total_handler_ms` p50
295–338ms, p99 851ms — is kept only as the Gate 1 "before" baseline. It does not inform
the deadline, and the storefront never calls it: every failure goes local, per R-8.)

And a 5s deadline fails in the direction that hurts. If Meilisearch is *dead*, the
browser finds out in milliseconds — DNS failure and connection-refused do not wait. The
deadline only ever applies to the *slow* case, and there the shopper pays the full 5s
**and then** waits for native search to run. That is worse than having no fallback at
all, and it happens precisely when Meilisearch is under load, i.e. when many shoppers
hit it at once.

So: **1000ms for typeahead, 2500ms for a committed search**, via
`AbortSignal.timeout`. The typeahead number is
sized for a cold connection on mobile — DNS + TLS before the 6ms query — not for
Meilisearch being slow, which it has never been. Warm requests will land near 60–160ms.
No retry on typeahead: the next keystroke supersedes the request anyway.

Then the error-class split (R-18) and the 2-strikes/60s breaker, so an incident costs a
shopper one deadline rather than one per keystroke. And no `/health` pre-flight, ever
(R-19) — detection for *us* is a pg_cron probe plus the `search_failed` records the
telemetry batch already carries.

## Data model

```mermaid
erDiagram
  instance ||--|| search_key : "has one permanent key"
  instance ||--o{ event_inbox : "receives raw telemetry"
  instance ||--o{ query_log : "owns searches"
  instance ||--o{ analytics_event : "owns funnel events"
  event_inbox ||--o| query_log : "drains into"
  event_inbox ||--o| analytics_event : "drains into"
```

- **search_key** (shipped 2026-11-02, migration `20261102000001_search_key.sql`) —
  `search_key_id` bigserial PK, `instance_id` FK, `key_uid`, `key_value`, `key_name`,
  `created_at`, `created_by`, `revoked_at`, `revoked_by`. Append-only with a partial
  unique index on `instance_id WHERE revoked_at IS NULL`, so at most one key is live
  per instance while revoked rows persist as the audit trail — the plan's first sketch
  keyed on `instance_id` alone, which left no trace of a cutoff and so could not
  satisfy R-9. `key_value` is plaintext on purpose: it is a public, read-only
  credential the merchant must be able to re-read. RLS is deny-all; reached only from
  `src/lib/search/search-key.ts` under the service-role client.
- **event_inbox** (new) — `event_id` PK (client-generated, the idempotency key),
  `instance_id`, `kind` (`search_performed` | existing event types), `payload` jsonb,
  `received_at`, `processed_at`. Append-only; pgmq is the alternative if available.
- **query_log** — unchanged shape. `denial_reason`, `status` and `total_handler_ms`
  become proxy-only artifacts, NULL for direct-mode rows.
- **analytics_event** — unchanged; now written by the drainer rather than inline.
- **instance** — unchanged. `storefront_domains` still gates the retained proxy.

## Phases

Each numbered item is one prompt's worth of work. Gates are blocking.

> **Phase 1 landed 2026-11-02.** Migration applied and verified against the live DB;
> `src/lib/search/search-key.ts` owns the lifecycle; the panel is on
> `/configuration/search`; 8 integration tests pass against real Meilisearch
> (including cross-instance refusal and detection of a key deleted by hand).
> Typecheck and build green. Nothing is wired into a storefront yet — Phase 2 next.

**Phase 1 — permanent key provisioning (GroLabs side)**

1. Migration: `search_key` table.
2. `getOrCreateInstanceSearchKey(instanceId)`: look up `search_key`; if absent,
   `createKey({ name: "grolabs-inst-N", actions: ["search"], indexes: ["inst_N"],
   expiresAt: null })` and store uid + value. Never list keys (R-6).
3. `revokeInstanceSearchKey(instanceId)`: `deleteKey(uid)`, stamp `revoked_at`.
4. Surface it on `/configuration/search`: the key, its status, a copy button, and a
   revoke action. This screen is what makes R-9 true.
5. Offboarding runbook step: delete the key, confirm the storefront degrades.
6. Vitest on instance 99999: creation is idempotent, scope is one index, revocation
   kills search, no cross-instance leakage.

**Phase 2 — deliver the key to the Shopify storefront**

7. Add `search_key` + `meilisearch_host` to the `grolabs-storefront` extension's block
   settings, beside the existing `instance_id` / `api_host`. One-time merchant paste
   (or CLI), no new Shopify scope, no re-authorization. `embed.liquid` also emits
   `preconnect` + `dns-prefetch` for that host (R-21).
8. Same two settings for the `grolabs-pixel` extension, so the pixel stops fetching an
   events token per page (R-5).

**Phase 3 — direct search + direct events in the storefront**

9. Port `pickMatchedVariation` + the facet allowlist into the shared client bundle.
10. `grolabs-typeahead.js` and `grolabs-results.js`: query
    `POST {host}/indexes/inst_N/search` with `Authorization: Bearer <key>` and
    `Meili-Include-Metadata: true` — raw `fetch`, no SDK (R-23) — with
    `attributesToRetrieve` trimmed to the rendered fields plus `variants` (R-22). Apply
    the ported matcher; keep the render contract identical. Suppress native only on
    results arrival, per R-20/R-24. CORS from the storefront is already proven by
    today's events path.
11. `grolabs-events.js` + the pixel: submit to Meilisearch `/events` with the config
    key; delete the token-fetch path.
12. Failover, per R-16 through R-20: `AbortSignal.timeout(1000)` on typeahead, `2500` on
    the results page; the 2-strikes/60s `sessionStorage` breaker; the error-class split
    (403 = revoked, degrade for the session, no retry; 429 = back off; timeout/5xx = count
    toward the breaker). Every branch ends at the platform's own search and none of them
    calls GroLabs. Audit the extension for suppression that fires at init rather than on
    results — that is what makes stepping aside possible (R-20). Log loudly; silent
    degradation is the failure mode this whole plan exists to avoid.
13. Server-side detection for us, not the shopper: a pg_cron probe hitting Meilisearch
    `/health` plus a canary search per active index, writing outcomes to
    `backend_operation`.

**Phase 4 — ingest + drain (GroLabs side)**

14. `/api/v1/events`: accept a batch array and a new `search_performed` kind, require
    `event_id`, append to `event_inbox`, return 202. Keep the single-event path working.
    Ships the `query_log.estimated_total_hits` migration and pins what the client reports
    into which column (R-26) — decide this before any direct-mode row is written, because
    a mid-flight change of meaning is not recoverable from the data.
15. Drainer (pg_cron): batch `event_inbox` → `query_log` + `analytics_event`, upsert on
    `event_id`, compute `intent_group_id` at drain, forward to PostHog, mark processed.
    Failures land in `backend_operation`.

**Phase 5 — storefront telemetry**

16. Batch queue in the extension: accumulate `search_performed` + funnel events, flush
    on 5s idle / page unload (`keepalive`), persist unsent batches to localStorage and
    retry on the next page view.
17. Dual-report every committed search (direct + proxy) behind a flag, for R-14.

**Phase 6 — guardrail. Blocking before any traffic moves.**

18. WAF rate limit in front of the Meilisearch host, per IP. Verify a synthetic flood
    is throttled at the edge and never reaches the cluster. This matters more than it
    did under the old design: the key is permanent, so nothing expires an abuser out.

**Gate 1 — positive path (T-1, T-2)** on instance 16: direct search returns results,
latency measured against the proxy baseline, every search lands in `query_log` with the
proxy's field set, the five-event funnel still attributes through a test order, and the
network log shows no GroLabs token calls. Report the measured browser-loss ratio from
step 16.

**Gate 2 — outage path (T-3)**: take GroLabs down deliberately, confirm search keeps
working, telemetry queues, and the queue flushes with no loss on recovery. How we
simulate the outage is an open decision below. Run T-4 and T-5 in the same session —
revocation is the other half of the availability bet.

**Phase 7 — cleanup**

19. Turn off dual-reporting; the proxy keeps serving ingest + back-compat only (R-11).
20. Amend `search-proxy-event-pipeline.md` (§6 answered; §2's hot-path hardening is
    mostly moot once the hot path is gone) and `docs/policy/search-foundations.md` §7
    (the proxy is no longer the storefront's primary path). `search-events.md` §4
    best-effort is superseded by R-10 — needs explicit sign-off per its own §8.
21. `grolabs-web-sdk`: its README promises "search, browser, no key". Direct mode
    contradicts that; the SDK needs a key story or an explicit two-mode README.

## Operator runbook — cutting an instance off

Enforcement is manual by decision (R-2): uptime matters more than stopping a
non-payer quickly, and at well under 100 tenants a human step costs nothing. It is
only real if someone performs it, so it is written down here rather than implied.

**To cut off an instance**

1. Open `/configuration/search` as a member of that instance. The **Storefront key**
   card shows the key and its state.
2. Click **Revoke key** and confirm. The key is deleted in Meilisearch and the row is
   stamped `revoked_at`.
3. The storefront stops returning results within seconds. Its catalog index is
   untouched — nothing needs re-ingesting if they come back.
4. Confirm on the storefront: search should fall back to the platform's own results
   (R-8/R-20), not error.

**Or by hand, in the Meilisearch console** — delete the key named `grolabs-inst-N`.
This is equally valid and equally immediate. Afterwards the panel reads
**DELETED IN MEILISEARCH**: it verifies the key against Meilisearch on load rather
than trusting our own row, so a by-hand deletion shows up instead of the panel
continuing to claim the instance is live. Click **Record revocation** there to bring
the record back in step.

**To reactivate** — click **Issue key** and paste the new value into the merchant's
Shopify block settings. The old key is dead and stays in the history.

**Known gap** (R-28): a key whose DB row was lost — a crashed provision, a manual
DB edit — keeps working and is invisible to this panel, because names are not unique
upstream and we deliberately never list keys to find ours. Until reconciliation
exists, an audit means looking in the Meilisearch console for keys scoped to
`inst_N` that the panel does not show.

## Related GroLabs modules

- **Search** — `/api/v1/search` (retained for ingest + back-compat, never a storefront fallback), `/api/v1/search/token` and
  `/api/v1/events/token` (retired for new storefront builds, kept for back-compat),
  `meilisearch-client.ts`, `variant-matcher.ts`, `rate-limit.ts`.
- **Analytics / event tracking** — `query_log`, `analytics_event`, `metric_daily`,
  `src/lib/analytics/metrics.ts`. The KPI catalog is unchanged; only who writes the
  rows changes.
- **Shopify search app** (`shopify-apps/grolabs-shopify-search`) — both extensions
  (`grolabs-storefront`, `grolabs-pixel`).
- **WordPress search plugin** (`wp-plugins/grolabs-wordpress-search`) — **out of scope,
  frozen** (R-12). Not touched by this plan and not awaiting parity.
- **Instance configuration** — `/configuration/search` gains the key panel (step 4).
- **Observability** — `backend_operation` for drainer and ingest failures.

## External apps + credentials

| What | Credential | Where it lives | Notes |
|---|---|---|---|
| Meilisearch | `MEILISEARCH_MASTER_KEY` | GroLabs server env | Only key/index admin uses it. Never leaves the server. |
| Meilisearch | per-instance search key, permanent | **search_key** + storefront config + page source | New. Read-only, one index, never expires. Covers search AND events. Revocation target. |
| Cloudflare / WAF | account + zone for the Meilisearch host | Ops | New. Blocking for Gate 1. |
| PostHog | `POSTHOG_API_KEY` | GroLabs server env | Unchanged; forwarding moves to the drainer. |
| Shopify | existing app token | Shopify app backend | **No new scope** — the key ships as a block setting. |

## Open decisions

1. **How we simulate the outage for Gate 2.** Pausing the Vercel production deployment
   is the most honest; a kill-flag that 503s every route is safer but tests less.
2. **pgmq vs a plain `event_inbox` table.** The pipeline doc leans pgmq; a plain
   append-only table is less to learn and enough at current volume.
3. **Whether tenant-token minting survives at all.** It is the only path to filtered
   search (per-shopper visibility, B2B price groups, a shared index). Keeping the code
   costs nothing; relying on it again would reintroduce expiry.
4. **Whether the permanent key is per instance or per storefront domain.** Per instance
   is simpler and matches index-per-instance; per domain would let one merchant's
   staging storefront be cut off independently.
5. **Numbered pages or load-more** (R-25). Load-more keeps today's cheap estimate;
   numbered pages need `page`/`hitsPerPage`, exact counts, a slower query per search, and
   a `maxTotalHits` raised above its 1000 default for any catalog that warrants it. This
   is a product decision that happens to set a performance cost, so it belongs to you,
   not to the implementation.
6. **Whether telemetry goes through a Shopify App Proxy** (`/apps/grolabs/…`, a
   same-origin path on the shop domain that Shopify forwards to our backend). It would
   make the beacon first-party and dodge the main cause of client-side loss. It does
   NOT survive a GroLabs outage — the proxy terminates at us — so it complements the
   localStorage retry queue rather than replacing it. Now that WordPress is out (R-12),
   this is the only remaining lever on telemetry fidelity; decide it off R-14's measured
   loss ratio rather than up front.
