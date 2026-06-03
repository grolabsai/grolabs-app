---
application: core-app
module: Design
title: "Search Proxy & Event Pipeline — Scaling / Fault-Tolerance Exploration"
status: Draft
owner: "Tuncho"
audience: "Claude Code (future implementer), GroLabs contributors scoping the event pipeline."
scope: "An exploration (no decisions locked) of how to harden the RRE search proxy and the event pipeline once richer events feed revenue findings. Covers the auto-scaling/Postgres-ceiling problem, two opposite failover models (search vs. events), a durable accept-fast/process-async buffer, the cost guardrail, and the separate-service-vs-in-app question."

actors:
  - name: RRE search proxy
    type: system
    definition: A full query proxy (not just a token broker) on Vercel serverless (nodejs runtime), each request an isolated horizontally-scaling invocation. Validates instance + origin, calls Meilisearch with the master-key client, runs the variant matcher, and logs every query to query_log.
  - name: WP plugin
    type: plugin
    definition: POSTs every storefront search to POST /api/v1/search; dual-writes events to both Meilisearch and RRE's analytics_event mirror.
  - name: Scheduled drainer
    type: system
    definition: A pg_cron job (same mechanism as blog + GA4 polling) that reads the durable buffer in batches, writes analytics_event, updates rollups, and marks events processed — decoupling ingest latency from processing latency.
  - name: Shopper
    type: human
    definition: Needs results now; tolerates a lost keystroke but not latency.

integrations:
  - name: Meilisearch
    kind: external-service
    target: RRE search proxy
    direction: both
    purpose: The downstream search; needs a tight timeout (~2s) + one retry + a circuit breaker so a spike fails fast with 503 + Retry-After instead of piling up concurrency and cost.
  - name: Supabase Postgres
    kind: external-service
    target: Rate-limit RPC, instance/origin lookup, query_log
    direction: both
    purpose: The real scaling ceiling — ~3–4 round-trips per keystroke. Connection exhaustion (not CPU) is the failure mode; must use the pooler (Supavisor/pgBouncer, transaction mode).
  - name: Redis (Upstash / Vercel KV)
    kind: external-service
    target: Rate limiting (proposed)
    direction: both
    purpose: Atomic INCR + TTL to move the throttle off Postgres, so the limiter that protects the DB is not itself a DB call.
  - name: pgmq / event_inbox
    kind: internal-module
    target: Durable event buffer (proposed)
    direction: both
    purpose: Postgres-native queue (or append-only table) — accept-fast, process-async; events pile up safely if the drainer lags. The lean starting choice over an external queue.
  - name: PostHog (external product) + local Supabase store
    kind: external-service
    target: Destination event store
    direction: out
    purpose: RESOLVED (2026-06-03, PostHog Analytics MVP). It is BOTH, with distinct roles — the real external product **PostHog** is the cross-event analytics/funnel destination (server-side forwarding via posthog-node from /api/v1/search and /api/v1/events; never posthog-js on the storefront), and the local Supabase store (analytics_event + query_log) remains the source of truth for in-app admin panels and the durable buffer this doc designs. "post-hoc" was never the product name; it described the local store.

rules:
  - id: R-1
    statement: RRE is already a full query proxy, not just a token broker — it validates instance + origin, calls Meilisearch with the master key, runs the variant matcher, returns results, and fire-and-forget logs every query to query_log with total_hits, query string, processing time, and denial reason.
    truth: true
    rationale: §1 "verified". Being in the request path is the opportunity and the blast-radius risk this doc reasons about.
  - id: R-2
    statement: The serverless proxy auto-scales but Postgres is the real ceiling — one keystroke costs ~3–4 Postgres round-trips + 1 Meilisearch call; under a spike thousands of invocations stampede the same Supabase and connection exhaustion (not CPU) is the failure mode. The rate limiter meant to protect under load is itself a DB call.
    truth: true
    rationale: §1 implication. Drives the "get the hot path off the primary DB" hardening.
  - id: R-3
    statement: 'Search and events have opposite tolerances and get different failover — search tolerates a lost keystroke but not latency (fail fast + degrade: timeout, circuit breaker, graceful "unavailable"); events tolerate latency but not loss once they feed revenue (durable buffer + async drain). The buffer is the failover for events and has no role in the search response path.'
    truth: true
    rationale: §§2,4. Corrects a discussion assumption that "the failover system is the same one that stores events."
  - id: R-4
    statement: The event pipeline uses accept-fast/process-async — the ingest endpoint validates origin, appends the raw event to a durable buffer, and returns 202; a scheduled drainer batches buffer → analytics_event → rollups → mark processed. Ingest latency is decoupled from processing latency, so a slow/down store makes events lag, never lost.
    truth: unverified
    rationale: §3. The durability answer to "what if we can't record it immediately"; proposed pattern, not yet built.
  - id: R-5
    statement: Events require server-side idempotency — each carries a client-generated event_id and the drainer upserts on it (events arrive twice via keepalive + retries); query_log writes route through the same buffer so the search hot path never synchronously touches analytics tables.
    truth: unverified
    rationale: §3 correctness requirements. Order dedup is client-side via localStorage today; server-side idempotency is the durable guarantee.
  - id: R-6
    statement: Start the buffer with pgmq (or a plain append-only event_inbox) on the current stack — lowest friction, durable, same stack — and graduate to an external queue only when analytics write volume contends with the app DB. Don't over-build the queue before traffic justifies it.
    truth: unverified
    rationale: §3 "lean". A leaning recommendation, not a locked decision.
  - id: R-7
    statement: The rate limiter is the cost cap (keep it; move it to Redis so it survives a DB blip) and the circuit breaker is the backstop — a traffic spike or a storefront stuck in a search loop auto-scales the bill and upstream load, so both guardrails are required.
    truth: true
    rationale: §5. Auto-scaling cuts both ways.
  - id: R-8
    statement: Ideally the proxy + event-recording system is a completely separate service (not tied to the whole app) for blast-radius isolation, independent scaling (shopper vs. merchant curves), independent deploys, and a right-sized edge runtime — but this is NOT decided; options range from status-quo in-app to a fully separate service + separate telemetry store.
    truth: unverified
    rationale: §6 directive captured 2026-05-28. Trade-offs (shared code factoring, more ops surface, the event-store choice) weighed but unresolved.
  - id: R-9
    statement: This pipeline amends search-events.md — §4 (best-effort/loss-acceptable no longer holds once events feed revenue) and §6 ("no aggregation API on RRE" — rollups will happen on RRE's side); that locked policy must not be amended without explicit sign-off.
    truth: unverified
    rationale: §8 related policy. A proposed amendment, pending authorization. See [[search-events]].

useCases:
  - id: T-1
    title: Drainer absorbs a downstream outage
    given: The destination event store or drainer is slow or down during traffic
    when: Events keep arriving at the ingest endpoint
    then: Each is validated and appended to the durable buffer with a 202; nothing is lost — processing lags and catches up on recovery
    verifies: [R-4]
  - id: T-2
    title: Meilisearch spike fails fast instead of piling up
    given: Meilisearch's error rate spikes under load
    when: The circuit breaker trips
    then: The proxy returns 503 + Retry-After and the storefront shows "search temporarily unavailable," rather than every function hanging the full timeout and piling up concurrency and cost
    verifies: [R-3, R-7]
  - id: T-3
    title: Duplicate event is deduped on drain
    given: A client retries an event (keepalive + retry) carrying the same client-generated event_id
    when: The drainer processes the buffer
    then: It upserts on event_id so the event is recorded exactly once
    verifies: [R-5]
---

# Search Proxy & Event Pipeline — Scaling / Fault-Tolerance Exploration

Status: **Draft / exploration — no decisions locked.** Revisit before we start recording events at volume.
Owner: Tuncho
Date: 2026-05-28
Audience: Claude Code (future implementer), GroLabs contributors scoping the event pipeline.

> **Why this doc exists.** We confirmed that RRE already acts as a *search proxy* between the
> WooCommerce storefront and Meilisearch, and we're about to layer richer event recording on top
> (journeys, cart value, revenue findings). Being in the request path is an opportunity — but it
> also puts us in the blast radius of storefront traffic. This captures the discussion so we can
> pick the right architecture when we actually build the event pipeline, rather than re-deriving it.

> **Terminology — RESOLVED (2026-06-03, PostHog Analytics MVP).** The destination was referred to
> throughout as "posthog" / "posthoc". It is **both**, with distinct roles, not an either/or:
> (a) the product **PostHog** is now the cross-event analytics/funnel destination — RRE forwards
> server-side via `posthog-node` from `/api/v1/search` ("Search Performed") and `/api/v1/events`
> (click/conversion), inside Next 15 `after()` so it never blocks the request; we never load
> posthog-js on the storefront. (b) The **local Supabase store** (`analytics_event` + `query_log`,
> now carrying `query_uid` / `user_id` / `intent_group_id`) remains the source of truth for the
> in-app admin panels and is the durable buffer this doc designs. "post-hoc" was never a product —
> it just described the local store. This doc's buffer/scaling design still targets (b).

---

## 1. What's actually deployed today (verified)

- **RRE is a full query proxy, not just a token broker.** The WP plugin POSTs every search to
  `POST /api/v1/search` ([src/app/api/v1/search/route.ts](../../src/app/api/v1/search/route.ts)),
  which validates instance + origin, calls Meilisearch with the master-key client, runs the variant
  matcher, returns results to WP, and **logs every query to `query_log`** with `total_hits`,
  query string, processing time, and denial reason.
- **Deployment:** Vercel serverless (`runtime = "nodejs"`). Each request is an isolated invocation
  that scales horizontally automatically.
- **Rate limiting is backed by Postgres**, not Redis or in-memory: `checkRateLimit` calls the
  `search_rate_limit_check` RPC ([src/lib/search/rate-limit.ts](../../src/lib/search/rate-limit.ts)).
  It **fails open** on infrastructure error (serves the request if the limiter is unreachable).
- **Events today** dual-write from the plugin to both Meilisearch (authoritative, trains relevance)
  and RRE's `analytics_event` table (local mirror). Per `docs/policy/search-events.md` they are
  **best-effort, loss-acceptable, no retries** — which was fine when they only fed relevance.

### Implication: the proxy auto-scales, but Postgres is the real ceiling

One keystroke on a search-as-you-type widget currently costs **~3–4 Postgres round-trips + 1
Meilisearch call**:

1. Postgres RPC — per-IP rate limit
2. Postgres SELECT — instance / origin lookup
3. Postgres RPC — per-(instance, origin) rate limit
4. Meilisearch query
5. Postgres INSERT — `query_log` (fire-and-forget — does not block the response)

The serverless layer will happily scale to thousands of concurrent invocations under a spike, and
they all stampede the **same Supabase Postgres**. **Connection exhaustion on Postgres is the
failure mode**, not CPU on a server. The rate limiter — the thing meant to protect us under load —
is itself a database call.

---

## 2. Hardening the search critical path

Search tolerates a lost keystroke but **not latency** — the shopper needs results now. So search
failover means *fail fast + degrade gracefully*, never *defer*.

1. **Confirm pooled connections (do this first).** Serverless must use Supabase's pooler
   (Supavisor / pgBouncer, transaction mode), never the direct connection string. Without it a
   burst opens hundreds of connections and Postgres refuses new ones — instant outage. This is the
   most common Vercel + Supabase outage cause. *(Open: verify which connection string the
   service-role client uses.)*
2. **Get the hot path off the primary DB.** Two of the four per-keystroke DB hits don't belong on
   Postgres:
   - **Rate limiting → Upstash Redis / Vercel KV** (atomic `INCR` + TTL). Removes 2 round-trips and
     removes the DB dependency from the throttle that's supposed to protect the DB.
   - **Instance / origin lookup → cache it** (changes rarely; in-function LRU or edge cache with a
     short TTL). Removes the 3rd.
3. **Meilisearch resilience.** Tight timeout (~2s) + one retry on transient failure, plus a
   **circuit breaker**: if error rate spikes, fail fast with `503 + Retry-After` so the storefront
   shows "search temporarily unavailable" instead of every function hanging the full timeout and
   piling up concurrency (and cost).
4. **Route `query_log` writes through the event buffer** (see §3) rather than a synchronous insert
   per keystroke, so the hot path never touches the analytics tables directly.

---

## 3. The event pipeline — durability & queueing

Events tolerate latency but **not loss** once they feed revenue findings — a dropped event is a
wrong number. This raises the durability bar above today's best-effort model.

### Pattern: accept-fast, process-async

- The ingest endpoint does the **minimum** — validate origin, append the raw event to a **durable
  buffer**, return `202` immediately. No joins, no rollups inline.
- A **scheduled drainer** (we already run pg_cron for the blog + GA4 polling) reads the buffer in
  batches → writes `analytics_event` → updates rollups → marks processed.
- If the event store / drainer is slow or down, events **pile up safely in the buffer** — nothing
  lost, processing just lags, and it catches up on recovery. **Ingest latency is decoupled from
  processing latency** — this is the answer to "what if the store doesn't respond immediately / we
  can't record it immediately."

### Buffer options (on the current stack)

| Option | Pros | Cons |
|---|---|---|
| **pgmq** (Postgres queue extension, Supabase-supported) | No new infra; transactional; visibility-timeout + archive built in; same stack | Analytics backlog shares the catalog DB — a flood can still contend |
| **External queue** (Upstash QStash / SQS / Kafka) | Fully isolates analytics from the app DB; blast radius contained | New moving part, credentials, more ops |

**Lean:** start with **pgmq** (or a plain append-only `event_inbox` table) — lowest friction,
durable, same stack. Graduate to an external queue only when analytics write volume contends with
the app DB. Don't over-build the queue before the traffic justifies it.

### Correctness requirements

- **Idempotency** — events arrive twice (keepalive + retries). Each carries a client-generated
  `event_id`; the drainer upserts on it. (Order dedup is client-side today via localStorage;
  server-side idempotency is the durable guarantee.)
- **Route `query_log` through the same buffer** so the search hot path never synchronously touches
  analytics tables.

---

## 4. Two failover mechanisms, by design

The search path and the event path have **opposite tolerances**, so they get different failover:

| Path | Tolerates | Does NOT tolerate | Failover mechanism |
|---|---|---|---|
| **Search** | losing a keystroke | latency | Fail fast + degrade (timeout, circuit breaker, graceful "unavailable") |
| **Events** | latency | loss (once they feed revenue) | Durable buffer + async drain (loss-free, lag-tolerant) |

The buffer is the failover for events; it has **no role** in the search response path. (Correcting
an assumption from the discussion that "the failover system is the same one that stores events.")

---

## 5. The cost / runaway guardrail

Auto-scaling cuts both ways — a traffic spike, or a misbehaving storefront stuck in a search loop,
auto-scales the **bill** and the Meilisearch / DB load along with it. The rate limiter is the cap
(keep it; move it to Redis so it survives a DB blip); the circuit breaker is the backstop when an
upstream misbehaves.

---

## 6. Open architectural question: separate service vs. in-app

**Directive captured (2026-05-28):** ideally the proxy + event-recording system should be a
**completely separate service**, not tied to the whole application.

Reasons this is attractive:

- **Blast-radius isolation.** Storefront search traffic is high-volume, untrusted, and spiky.
  Keeping it out of the admin app means a search/event flood can't take down the merchant-facing
  admin UI (catalog, pricing, imports), and vice versa.
- **Independent scaling.** The proxy scales with *shopper* traffic; the admin app scales with
  *merchant* usage. Very different curves — coupling them wastes resources and couples failure.
- **Independent deploys.** Hot-path changes ship without redeploying the whole app.
- **Right-sized runtime.** The proxy is a thin, latency-sensitive request handler; it can live on
  an edge runtime / dedicated service tuned for it, separate from the heavier Next.js app.

Trade-offs to weigh when we decide:

- Shared concerns (Supabase clients, instance/origin lookup, types, rate-limit logic) would need to
  be factored into a shared package or duplicated.
- Another service = another deploy target, another set of secrets, more ops surface.
- The event store choice (§ terminology note) interacts with this: if "posthog" is the external
  product, the separate-service question partly answers itself (ingest service → PostHog); if it's
  our own Supabase pipeline, the separate service still writes to the same DB unless we also split
  storage.

**Not decided.** Options to evaluate later: (a) keep everything in the Next.js app (status quo);
(b) extract a standalone ingest/proxy service that still writes to the shared Supabase; (c) fully
separate service + separate telemetry store.

---

## 7. Suggested first moves (smallest risk → biggest payoff)

1. Confirm the **pooled** Supabase connection string is what the service-role client uses.
2. Move **rate limiting to Redis** (Upstash / Vercel KV).
3. Stand up a **buffer (pgmq)** and route both event ingest *and* `query_log` through it.

These are independent of the bigger "separate service" decision and de-risk the hot path regardless
of how that question lands.

---

## 8. Related policy (read before building)

- `docs/policy/search-foundations.md` — the proxy contract (§7), rate-limit RPC (§6).
- `docs/policy/search-events.md` — current event flow. **This pipeline amends it:** §4
  (best-effort/loss-acceptable no longer holds once events feed revenue), and §6 ("no aggregation
  API on RRE" — we *will* roll up on our side). Do not amend that doc without explicit sign-off.
- `docs/policy/ga4-integration.md` — the poll-then-anomaly model the scheduled drainer + rule
  evaluation mirrors.
