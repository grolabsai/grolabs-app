---
application: core-app
module: Security
title: "M1 security audit — index & overall verdict"
status: "Complete — 1 critical, 1 medium-high, 2 medium, remainder low/latent"
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Index of the 2026-08-02 M1 security audit. Five documents: the tenant-isolation proof plus four clusters. All findings are report-only — no application code was changed."
---

# M1 security audit — index & overall verdict

Conducted 2026-08-02 against `main @ c616c18` and, where noted, the live
production deployment + database (project `scout`). **Report-only: no
application code was changed.** Scope was the `grolabs-app` only (the three
WordPress plugins were explicitly out of scope for this pass).

## Overall verdict

**The foundations are sound; the risk lives at the edges.** Tenant isolation via
RLS holds, the escalation pivot is closed, ~180 server actions use consistent
correct authorization, secrets are hashed and never logged, and the auth surface
is carefully built. The findings are not systemic weaknesses — they are specific
edge defects: a Postgres view default, an Origin-trust assumption, an unguarded
URL fetcher, a spoofable IP, some stale dependencies.

**One finding blocks M1** (the RLS-bypassing views), and it arms itself the
moment HPC starts sending events. Everything else is a "fix before you widen the
blast radius" item, not a "the model is broken" item.

## Documents

| Doc | Cluster | Result |
|---|---|---|
| [`2026-08-02-tenant-isolation.md`](2026-08-02-tenant-isolation.md) | Isolation (P0) | 26/27 live checks pass; **1 critical**, 1 latent |
| [`2026-08-02-service-role-usage.md`](2026-08-02-service-role-usage.md) | 1 | 0 critical; 2 medium, 1 low |
| [`2026-08-02-server-action-authz.md`](2026-08-02-server-action-authz.md) | 2 | 0 critical/medium; 1 low + 2 obs |
| [`2026-08-02-public-surface.md`](2026-08-02-public-surface.md) | 3 | 1 medium-high, 1 low-medium + obs |
| [`2026-08-02-auth-secrets-deps.md`](2026-08-02-auth-secrets-deps.md) | 4 | 0 critical; 1 medium + obs |

## All findings, ranked

| # | Severity | Finding | Proven | Doc |
|---|---|---|---|---|
| 1 | 🔴 **Critical** | 3 views (`event_stream`, `session_assignment`, `metric_daily_source`) bypass RLS — every instance's analytics readable by any authenticated user | **live** | isolation |
| 5 | 🟠 Medium-high | SSRF in the public diagnostic API — unauth'd server-side fetch of caller URL, no internal-address guard, follows redirects, semi-blind via readback | code | 3 |
| 1c | 🟠 Medium | Origin used as auth boundary on storefront endpoints — forgeable by non-browser clients | **live** | 1 |
| 2 | 🟠 Medium | Funnel shared-table writes gated by authentication only — any logged-in user mutates the global funnel model | code | 1 |
| 7 | 🟠 Medium | 9 vulnerable prod dependencies (6 high); `dompurify` (blog XSS defense) + `xlsx` (no fix, parses uploads) notable | `npm audit` | 4 |
| 6 | 🟡 Low-med | Rate limiter reads spoofable first `x-forwarded-for` — bypasses every per-IP limit | code | 3 |
| — | 🟡 Latent | `brand_system` SELECT is `using(true)` — world-readable; harmless until per-instance brand rows exist | code | isolation |
| 3 | 🟡 Low | Event/order ingest endpoints have no rate limiting | code | 1 |
| 4 | 🟡 Low | 24 `(admin)` prospects server actions lack an admin gate (self-scoped, bounded today) | code | 2 |

Plus observations O-1..O-10 across the cluster docs (API-cost abuse, template
metadata exposure, SSO hook lives outside repo, layout-vs-action gating,
password policy, etc.).

## The through-line

Several findings are the **same class**: a control enforced at one layer while a
different layer is the real entry point.

- Views trust their owner instead of the caller (Finding 1).
- The funnel actions and the `(admin)` actions trust the *page* gate instead of
  gating the *action* (Findings 2, 4).
- Layouts gate rendering while server actions stay open (O-8).

Worth a single defensive habit in the PR checklist (CLAUDE.md §15): **authorize
at the layer that actually executes** — the view, the action, the RPC — not only
at the layer in front of it.

## What was NOT audited

WordPress plugins; live SSRF exploitation (deliberately); DoS/load; the Supabase
project's dashboard configuration (auth hooks, PITR, Vault, network rules —
tracked as a go-live P0); runtime CVE behavior; deep webhook-signature fuzzing.

## Suggested order of remediation

1. **Finding 1** (critical, blocks M1) — 3 `alter view … set (security_invoker = on)`; re-run `npm run test:isolation`.
2. **Finding 6** (IP spoofing) — one-line fix; it's the precondition for the rate-limit mitigations below to hold.
3. **Finding 7** — `npm audit fix` (prioritize `dompurify`); decide on `xlsx`.
4. **Findings 2 & 4** — one shared `assertGroLabsAdmin()` guard closes both.
5. **Finding 5 (SSRF)** — shared fetch guard; land before promoting the public diagnostic widget to untrusted traffic.
6. **Findings 1c & 3** — decide the storefront Origin posture and add ingest rate limiting **before HPC registers a storefront domain**.
7. **`brand_system`** — fix the policy before shipping per-instance brand rows.

All findings are tracked in [`../go-live.md`](../go-live.md).
