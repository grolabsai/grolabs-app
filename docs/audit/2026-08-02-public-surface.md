---
application: core-app
module: Security
title: "Audit — public / unauthenticated surface (cluster 3)"
status: "Findings — 0 critical, 1 medium-high, 1 low-medium + observations"
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Cluster 3 of the M1 security audit. Every endpoint reachable without a session: the public diagnostic API, the short-link redirector, public content routes (blog/rss/sitemap/llms), the OAuth callback, and the origin-bound storefront endpoints (trust model already covered in cluster 1). Executed 2026-08-02 against main @ c616c18. SSRF was confirmed at the code level and deliberately NOT fired against live infrastructure."
---

# Audit — public / unauthenticated surface

**Scope:** everything an anonymous internet caller can reach. The origin-bound
storefront endpoints (`/api/v1/{search,events,orders,*/token}`) had their trust
model dissected in cluster 1 (Finding 1); this cluster covers the rest and does
not repeat them.

**Verdict:** one **medium-high** finding — server-side request forgery in the
public diagnostic API — and one **low-medium** — the rate limiter reads a
spoofable client IP, which weakens the main abuse control. Everything else on
the public surface is well-built, and the blog HTML path in particular is a
model of correct sanitization.

**Testing posture:** the SSRF is unambiguous from the source and I confirmed
there is no guard anywhere in the tree. I did **not** fire it against internal
or cloud-metadata addresses on the live deployment — that would mean directing
production infrastructure to attack itself, which is outside safe authorized
scope and can have real side effects. The finding is marked CONFIRMED-IN-CODE.

---

## FINDING 5 — MEDIUM-HIGH: SSRF in the public diagnostic API

**Status:** open · **Severity:** medium-high · **Confirmed in code (not fired live)**

`POST /api/v1/diagnostic/runs` is **public and unauthenticated** (CORS `*`, no
session, no key). It takes a caller-supplied `url` and fetches it server-side to
score the storefront. There is **no protection against internal targets**:

- **No scheme restriction.** `normalizeUrl` (`runner.ts:78`) only prepends
  `https://` when no scheme is present; an explicit `http://…` is preserved
  (`/^https?:\/\//i`). Nothing blocks non-storefront hosts.
- **No private/internal-address blocklist.** A tree-wide search for any guard
  (`169.254`, `metadata`, `127.0.0.1`, `10.`, `192.168`, `::1`, private-IP /
  DNS-resolution checks) returns **nothing**. There is no allowlist either.
- **Redirects are followed.** `fetchWithTimeout` (`site-checks.ts:20`) sets
  `redirect: "follow"`, so even a benign public URL that 302s to
  `http://169.254.169.254/…` is chased without re-validation — the classic SSRF
  filter-bypass.
- **Multiple fetch sites** consume the URL: `site-checks.ts` (raw HTML),
  `sample-discovery.ts` (homepage + discovered PDP/category links), the PSI
  probe, the ASE signal service, and the Browserless browser probe.

### It is not blind — there is a readback channel

`sample-discovery.ts` extracts `<h1>` text, a stripped-tag snippet, and
`og:image` from the fetched page and stores them on the `prospect`
(`display_name`, `logo_url`, …). Per-check `finding.evidence` (JSONB) also
persists probe evidence. **All of this is returned by the public
`GET /api/v1/diagnostic/runs/{runId}`.** So an attacker can fetch an internal
URL and read parts of the response back — semi-blind SSRF, not fully blind.

### How far it reaches

The actual blast radius depends on what the Vercel serverless egress can route
to (cloud metadata endpoints, internal service IPs, the Supabase host, other
private infrastructure) — which I did not probe live. On a typical serverless
platform some internal ranges are unreachable and some (metadata, same-VPC
services) may not be. Treat it as medium-high until the egress is characterized;
the code offers zero defense, so the only thing bounding it today is the
platform, not the app.

### Also reachable authenticated

The same engine is invoked by `startDiagnostic`, `rescanProspectPage`, and
`rescanAllProspectPages` (cluster-2 handoff). Those require a login but, per
cluster-2 Finding 4, are not admin-gated — so any authenticated user, including
a beta client, can also drive the fetcher.

### Fix

Add an SSRF guard in front of every diagnostic fetch (one shared helper):

1. Allow only `http`/`https` schemes.
2. Resolve the hostname and **reject private, loopback, link-local, and
   metadata ranges** (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`,
   `169.254/16`, `::1`, `fc00::/7`, `0.0.0.0`) — check the *resolved IP*, not
   just the literal, to catch DNS rebinding.
3. Re-validate **after each redirect** (or set `redirect: "manual"` and
   re-check every hop).
4. Keep the existing timeout; consider a response-size cap.

Because the readback channel is real, this should land before the public
diagnostic widget is promoted anywhere it can attract untrusted traffic.

---

## FINDING 6 — LOW-MEDIUM: rate limiting reads a spoofable client IP

**Status:** open · **Severity:** low-medium

Both the public diagnostic API (`getClientIp`, `runs/route.ts:56`) and the
storefront token endpoints (`search/token/route.ts:68`, `events/token`) resolve
the client IP as:

```ts
const xff = req.headers.get("x-forwarded-for");
if (xff) return xff.split(",")[0].trim();   // ← first entry
const real = req.headers.get("x-real-ip");   // ← only a fallback
```

On Vercel the platform **appends** the true client IP to `x-forwarded-for`, so
the **first** entry is whatever the client sent. An attacker sets a fresh fake
`X-Forwarded-For: <random>` on each request and every per-IP bucket
(`record_diagnostic_request`, `checkRateLimit`) sees a brand-new IP — the limit
never trips.

This matters more than it looks because rate limiting is the **primary abuse
control** for the whole public surface, and it is the exact mitigation proposed
for cluster-1 Findings 1 and 3 and for Finding 5's resource-abuse angle. If the
limiter is bypassable, those mitigations are too.

**Fix:** trust the platform-supplied value only — use `x-real-ip` (Vercel sets
it to the real client and a client cannot override it), or take the **last**
`x-forwarded-for` entry (the platform-appended hop), not the first. Apply the
same fix to every IP-based limiter.

---

## Observations (lower severity / informational)

**O-3 — synchronous diagnostic + spoofable limit = resource/cost amplification.**
`runs/route.ts` sets `maxDuration = 300` and runs the legacy diagnostic
synchronously. One request can hold a serverless function for up to 300s doing
attacker-directed fetches; combined with Finding 6 the per-IP cap doesn't bound
it. Bounds: platform concurrency + Vercel function-time cost. Fix rides on
Finding 6 plus perhaps an async/queued model for the legacy path (v5 already
uses `after()`).

**O-4 — short-link target has no scheme check.** `/s/[code]` 302-redirects to a
DB-stored `target_url` set by the link's authenticated creator (scoped to their
instance) — this is a URL shortener behaving normally, not an open redirect. Minor:
the stored target isn't validated to be `http(s)`. `javascript:`/`data:` in a
`Location` header isn't executed by browsers, so impact is negligible; worth an
`http(s)`-only check for hygiene.

**O-5 — public run read model is sound.** `GET /runs/{runId}` is gated to
anonymous runs (`instance_id === null` → else 404), keyed on a UUID share token
(enumeration-resistant), and does **not** expose `contact_email`. Its only
security weight is being the readback channel for Finding 5.

**O-6 — host→instance resolution is separation, not authorization** (CLAUDE.md
§13, already known). Public content routes (`blog`, `rss.xml`, `sitemap.ts`,
`llms.txt`) resolve the instance from the `Host` header and fall back to
instance 0. The data served is public by definition (published posts only —
`post` RLS grants anon read of `status='published'`), so this is acceptable; it
is noted only so nobody mistakes host routing for a tenant boundary.

---

## What is built correctly (worth recording)

- **Blog stored-HTML rendering is a model of correct handling.** `sanitizeHtml`
  (`lib/blog/render.ts`) runs `isomorphic-dompurify` with an explicit
  tag/attribute allowlist and `ALLOWED_URI_REGEXP` that permits only
  `https:/mailto:/tel:/` relative — so `javascript:` URIs are stripped. The
  `dangerouslySetInnerHTML` at `blog/[slug]/page.tsx:252` renders the sanitized
  copy, and `jsonLdScriptContent` escapes `</script`. No stored-XSS finding.
- **Anonymous diagnostic runs are isolated** from authenticated-instance runs
  (`instance_id === null` gate) and from customer PII (`contact_email` withheld).
- **The origin-bound storefront endpoints** validate instance + origin and pin
  `instance_id` on every query (trust-model caveat is cluster-1 Finding 1).

---

## What this cluster did NOT cover

- **Live SSRF exploitation** (deliberately — see testing posture).
- **The OAuth `/[locale]/auth/callback`** beyond noting it exists; the GA4 OAuth
  `state` nonce validation was spot-checked in cluster 1. A full OAuth/session
  flow review belongs to cluster 4 (auth surface).
- **DoS / volumetric testing** — no load was generated against production.

---

## Recommendation

- **Finding 5 (SSRF)** is the priority. It doesn't block M1 with the widget kept
  off untrusted traffic, but the guard should land before the public diagnostic
  is promoted, and the authenticated path (`rescan*`) should get the cluster-2
  admin gate regardless.
- **Finding 6 (IP spoofing)** is a small, high-leverage fix — do it alongside the
  cluster-1 rate-limit work, since it's a precondition for those mitigations to
  actually hold.
