---
application: core-app
module: Operations
title: "GroLabs — Go-Live checklist (MVP beta → public launch)"
status: Living checklist
owner: "Tuncho"
audience: "Anyone taking GroLabs from dev into production. Two milestones: M1 trusted-client MVP beta, M2 full public launch. Work M1 first."
scope: "Operational readiness for the grolabs-app deployment + the three WordPress plugins. Re-grounded against the repo (main @ c616c18) and the live production DB on 2026-08-02. Verify every [VERIFY] item against the live project — do not assume."
---

# GroLabs — Go-Live checklist

Two milestones. **Do M1 first.** M2 builds on M1.

| | **M1 — Trusted-client MVP (private beta)** | **M2 — Full public launch** |
|---|---|---|
| **Audience** | A few hand-picked, hand-provisioned clients (today: **HPC**). GroLabs operates it closely. | Anyone can sign up self-serve. |
| **Posture** | "Real data, real clients, but we're watching it and clients trust us through bumps." | "Unattended, self-serve, SLA-grade." |
| **Gate** | Tenant data isolation proven + safe deploy + happy-path works end-to-end. | Authz hardened, signup, scale, legal. |

## Current state (re-verified 2026-08-02)

Two of the four blockers recorded in the 2026-06-14 revision have since closed:

- ✅ **SEC-001 is CLOSED.** `src/lib/auth/admin.ts` `isGroLabsAdmin()` is now a
  real check delegating to the `SECURITY DEFINER` SQL mirror
  `public.is_grolabs_admin()`, and it fails closed on RPC error. Verified
  present in the live DB on 2026-08-02; only `tuncho@grolabs.ai` passes it.
- ✅ **CI test gating is back on.** `test.yml` triggers were restored
  2026-07-14; the prospectos-v5 failures were triaged as test drift and the
  suite is green (183/183, PR #262). A live-storefront E2E tier exists
  (`npm run test:e2e`), deliberately kept out of CI.

Still open, and the reason this is **managed-beta shape rather than open-launch
shape**: no public signup (by design — `user-management.md`), schema drift
between the migration files and the live DB, and the isolation proof below has
**not yet been run**.

---

## M1 — Trusted-client MVP (do this first)

### P0 — hard gates (must be true before any client touches it)

- [ ] 🔴 **BLOCKER — three views bypass RLS.** `event_stream`, `session_assignment` and `metric_daily_source` are views without `security_invoker`, so they execute as their owner and return **every instance's rows to any authenticated user**. Proven live 2026-08-02. Today the exposed data is instance 16 + the test fixture; HPC is absent only because it isn't sending events yet — the leak opens the moment it does. Fix is one `alter view … set (security_invoker = on)` per view. Full write-up: [`audit/2026-08-02-tenant-isolation.md`](audit/2026-08-02-tenant-isolation.md).
- [x] **Tenant/instance data isolation is PROVEN, not assumed** — for tables. Run 2026-08-02: 26/27 checks passed; the only failure is the view finding above. RLS read/write isolation and the `instance_member` escalation pivot both hold.
  - [x] **Functional proof:** run `npm run test:isolation -- --yes` (against the target DB; needs the 3 Supabase env vars). It provisions two throwaway worlds, signs in as each user with the anon key, asserts cross-tenant reads return nothing + cross-tenant writes are rejected, then cleans up. Must report all checks passed. (`scripts/test-tenant-isolation.mjs`)
  - [ ] **Coverage proof:** run `scripts/tenant-isolation-rls-coverage.sql` in the Supabase SQL editor. Every table with an `instance_id` column must show RLS enabled + an isolation policy (or a deliberate service-role-only verdict). Any `RLS DISABLED` row is a launch blocker.
  - [x] **Escalation path — now TESTED and holding.** Isolation hinges entirely on `instance_member.is_current` (that is literally what `current_instance_id()` returns). All four attacks are blocked: repointing your own membership row, self-granting a membership on another instance (a guard trigger fires), self-granting a `tenant_member` row, and bumping your role on a foreign membership. Post-conditions re-verified after the attempts.
  - [ ] **Add a `security_invoker` rule to the PR checklist** (CLAUDE.md §15). This defect class is invisible in code review — the view definition looks correct. Any new view over an instance-scoped table must set it.
  - [ ] Spot-check the remaining surfaces by hand: GA4 tables, `query_log`, blog `post`, prospectos `prospect`/`diagnostic_run`.
  - [ ] Confirm no app code relies on `WHERE instance_id = X` as the *only* isolation (RLS must stand alone) — CLAUDE.md §2.
  - [ ] Confirm `instance_id = 0` (template) rows are not leaking into client views.
- [x] **SEC-001 closed.** `isGroLabsAdmin()` is a real template-tenant membership check backed by `public.is_grolabs_admin()`. No edge stopgap needed. Verified in cluster-1 audit: `users.ts` re-checks admin on every mutating entry point.
  - [ ] 🟠 **Finding 2 (cluster 1, MEDIUM) — gate the funnel shared-table actions.** Confirmed live in code: 6 actions in `src/lib/actions/funnel.ts` write **globally shared** tables (`funnel_flow`/`funnel_stage`/`funnel_transition`, no `instance_id`) behind an authentication-only guard — any logged-in user, including a beta client, can mutate the funnel model all tenants see. Fix = the `is_grolabs_admin()` check `users.ts` already uses. [`audit/2026-08-02-service-role-usage.md`](audit/2026-08-02-service-role-usage.md).
- [ ] 🟠 **Finding 1 (cluster 1, MEDIUM) — decide the storefront Origin trust model BEFORE HPC registers a domain.** `Origin` is used as the auth boundary on `/api/v1/{events,orders,search,search/token,events/token}`, but Origin is forgeable by any non-browser client. Proven live 2026-08-02: curl with `Origin: http://localhost` wrote a fake conversion event and minted a working search token for instance 99999. Impact is per-instance (analytics/revenue/relevance poisoning + index read), not cross-tenant — but it arms against HPC the moment HPC sets `storefront_domains`. Options: accept+document, or add a per-instance shared secret. [`audit/2026-08-02-service-role-usage.md`](audit/2026-08-02-service-role-usage.md).
- [ ] 🟡 **Finding 3 (cluster 1, LOW) — rate-limit the ingest endpoints.** `/api/v1/events` and `/api/v1/orders` have no rate limiting (the token endpoints do). Cheap fix with `checkRateLimit`; it's also the mitigation lever for Finding 1.
- [ ] 🟠 **Finding 5 (cluster 3, MEDIUM-HIGH) — SSRF in the public diagnostic API.** `POST /api/v1/diagnostic/runs` (unauthenticated) fetches a caller-supplied URL server-side with no scheme restriction, no private/internal-address blocklist, and `redirect: "follow"` — and fetched content (h1/snippet/og:image/`finding.evidence`) reflects back through the public `GET /runs/{runId}`, so it's semi-blind, not blind. Confirmed in code (not fired live against infra). Same engine is reachable authenticated via `rescanProspectPage`/`startDiagnostic`. Fix = SSRF guard (scheme allowlist + resolved-IP private-range block + re-validate per redirect). Land before promoting the public widget to untrusted traffic. [`audit/2026-08-02-public-surface.md`](audit/2026-08-02-public-surface.md).
- [ ] 🟡 **Finding 6 (cluster 3, LOW-MEDIUM) — rate limiter reads a spoofable IP.** `getClientIp` and the token endpoints take the **first** `x-forwarded-for` entry, which is client-controlled on Vercel (platform appends the real IP). Rotating a fake XFF bypasses every per-IP limit — including the one proposed as the mitigation for Findings 1, 3, and 5. Fix = use `x-real-ip` or the last XFF hop. [`audit/2026-08-02-public-surface.md`](audit/2026-08-02-public-surface.md). *Cluster-3 positives: blog stored-HTML is correctly DOMPurify-sanitized (no XSS); anonymous diagnostic runs are isolated from instance runs + withhold contact_email; short-link is not an open redirect.*
- [ ] 🟡 **Finding 4 (cluster 2, LOW) — gate the (admin) prospects server actions.** 24 server actions under the `(admin)` route group have no `isGroLabsAdmin()` check; the layout gates page rendering but not direct server-action POSTs. Bounded today because every action self-scopes via `currentInstanceId()` + RLS (blast radius = caller's own instance), but it's "one refactor from serious" the moment any action takes an `instanceId` param or writes instance-0/shared rubric data. Fix = add the admin check to each. Full write-up: [`audit/2026-08-02-server-action-authz.md`](audit/2026-08-02-server-action-authz.md). *Overall cluster-2 verdict: strong — no critical/medium; ~180 actions use 4 consistent, correct authz patterns.*
- [ ] **Secrets are clean.** `SUPABASE_SERVICE_ROLE_KEY` and all API keys live only in Vercel env (server scope), never shipped to the browser, never committed. `.env` and `.env.local` are both gitignored (verified 2026-08-02, `.gitignore:21,26`).
  - [ ] ⚠️ **Local env footgun:** `.env.local` takes precedence over `.env` for both Next.js and the scripts, and dotenv never overwrites an already-set var — so a leftover `<paste …>` placeholder in `.env.local` silently shadows a real key in `.env`. This bit us on 2026-08-02. The placeholder lines are now commented out with a warning header.
- [ ] **Production Supabase decided.** [VERIFY] whether `ixbbhwtpnebrhquunege` (project `scout`) is the intended *production* project or a shared dev project. It currently holds **1 real customer (HPC), 4 auth users, and 5 instances** — that reads more like staging-with-a-customer-on-it than a hardened prod. Either way:
  - [ ] Daily backups / PITR enabled — **confirm before running any write-path test.**
  - [ ] All **114** migrations applied and verified in the target project (`information_schema` spot-checks — migrations do **not** auto-apply on deploy; CLAUDE.md §12).
  - [ ] **⚠ Schema drift (found 2026-06-14, STILL OPEN 2026-08-02):** the migration files are **not** a complete description of the live schema. Nothing in `supabase/migrations/` ever creates `instance_member`, yet later migrations `alter table public.instance_member`. A fresh `supabase db reset` from the repo would fail. The live cloud DB remains the real source of truth. Reconcile via `supabase db pull` into a baseline migration before M2.
  - [ ] RLS confirmed **enabled** on every operational table (not just present in migration files).
- [ ] **Happy path works end-to-end on the deployed URL** (not just locally): log in → products list → product detail → categories → a dashboard tab renders → search/no-results screen loads. Manual is fine for M1.

### Client readiness — HPC (instance 11)

Found during the 2026-08-02 live re-verification. Both may be expected
pre-launch state; confirm which.

- [ ] ⚠️ **`storefront_domains` is empty on instance 11.** The search plugin validates the storefront origin against this array — with it empty, search requests from the HPC storefront do not resolve to the instance and silently fall back to native WooCommerce. Claim `www.hpcenlinea.com.gt` before go-live.
- [ ] ⚠️ **HPC's Algolia credentials return HTTP 403** (app `JHRVDX111N`, index `prod_hpc`, last verified 2026-06-11 — ~7 weeks stale). Re-verify or rotate.
- [ ] Confirm the intended engine for HPC: instance 11 is on `search_provider = algolia` while `search-foundations.md` describes Meilisearch as the platform engine. Deliberate or legacy?
- [ ] HPC has **no tenant-level `owner`** — both members are `admin`. Confirm that's intended under the role taxonomy.

### Instance hygiene

- [ ] **Repoint the E2E tier.** `playwright-e2e.config.ts` targets "grolabs.io → instance 12" with `STOREFRONT_URL=https://grolabs.io`; **instance 12 no longer exists** and nothing claims that domain. Instance 16 (Shopify Dev) is the natural successor but is Shopify, not WordPress. Same stale reference in `docs/design/testing-approach.md`.
- [ ] **Investigate the removal of instances 12, 13, 15 and tenant 7** — present on 2026-07-19, absent on 2026-08-02, with no PR recording it. Intentional cleanup or data loss? See `docs/state/instances.md` → Open questions.
- [ ] **Instance 17 (`www.grolabs.ai`) is `kind = template`** — a second template-kinded instance. Almost certainly should be `customer`; any code identifying the template by `kind` rather than `instance_id = 0` will match both.
- [ ] **Instances 0 and 17 share GA4 property `526309917`** — will double-count in cross-instance aggregates.

### Environment & deploy (M1)

- [ ] Vercel project connected to `main`; build = `npm run build`, install = `npm install` (per `vercel.json`).
- [ ] **Required env vars set in Vercel** (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build-time + runtime)
  - `SUPABASE_SERVICE_ROLE_KEY` (server only)
  - `MEILISEARCH_HOST`, `MEILISEARCH_MASTER_KEY` (search proxy + token minting) — ⚠️ **`MEILISEARCH_MASTER_KEY` is a placeholder in both local env files; there is no real value anywhere in the repo.** Confirm the real key exists in Vercel.
  - `ANTHROPIC_API_KEY` (blog AI + prospectos Haiku tie-breaker)
  - `CRON_SECRET` (authorizes the Vercel cron below; [VERIFY] the endpoint enforces it)
  - `NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_BUILD_DATE` (auto-set by Vercel — confirm footer shows real SHA, CLAUDE.md §13)
- [ ] **Cron job live:** `vercel.json` schedules `/api/v1/integrations/ga4/poll` daily at 06:00. Confirm it runs and is auth-protected by `CRON_SECRET`. (Live GA4 `last_pull_status` was `ok` at 2026-08-02T06:53Z on instances 0, 16, 17 — the poll is running.)
- [ ] **Blog scheduling pg_cron** (Supabase, 5-min granularity per `blog.md`): if blog is in scope for beta, confirm the pg_cron job + its shared secret are configured. If blog is NOT in M1 scope, disable/ignore.
- [ ] Feature-gated integrations explicitly ON or OFF for beta (all default to no-op when unset):
  - Prospectos: `PROSPECTOS_BROWSER_PROBE_ENABLED`, `BROWSERLESS_HOST/TOKEN`, `PROSPECTOS_PSI_ENABLED`, `GOOGLE_PSI_API_KEY`, `ASE_API_URL`, `PROSPECTOS_V5_ENABLED`
  - Sales funnel (GroLabs's own, not per-client): `CALCOM_WEBHOOK_SECRET`, `KLAVIYO_PRIVATE_API_KEY`
  - Analytics forwarding: `POSTHOG_API_KEY`, `POSTHOG_HOST`
  - Image gen: `REPLICATE_API_TOKEN`
  - → Decide per integration; leaving unset is safe.
- [ ] SSO (if used in beta): `GOOGLE_OAUTH_REDIRECT_URI` set; Supabase Auth providers + redirect URLs configured for the prod domain. (3 of 4 live users already have `google` among their providers.)

### Client onboarding (M1 — manual is acceptable)

- [ ] Documented runbook to provision a new client: create `tenant` + `instance` + first `instance_member` (+ `tenant_member`), set the user's password / send invite. (No public signup — that's M2, and per `user-management.md` may stay admin-provisioned permanently.)
- [ ] Client catalog loaded (WooCommerce import per `wc-import.md`, or seed).
- [ ] Forced first-login password change for provisioned users ([VERIFY] `user_metadata.must_change_password` flow is live).
- [ ] New rows recorded in `docs/state/instances.md` **in the same PR** — the update protocol was skipped between 2026-07-19 and 2026-08-02, which is how the canonical map came to disagree with the DB.

### WordPress plugins (M1 — the storefront side)

- [ ] Search plugin (**v0.16.1**) installed on the client storefront, **Instance ID** configured.
- [ ] Client storefront domain added to the instance's `storefront_domains` — see the HPC item above; without it, search silently falls back to native WC.
- [ ] `GROLABS_API_HOST` left at default (`https://app.grolabs.ai`) in production wp-config (only overridden for local dev).
- [ ] Verify the five event types reach Meilisearch Cloud analytics (README "Events flow"); confirm click→conversion attribution works on the real store.
- [ ] GA4 plugin (**v0.2.6**): client's GA4 Measurement ID + (recommended) Measurement Protocol API Secret configured. Note: the secret is stored **plaintext** in `wp_options` (documented tradeoff) — flag to the client.
- [ ] Login plugin (v1.1.0, unchanged since May): provider OAuth apps created, redirect URIs set, at least one provider walked through the plugin's manual test plan. Apple JWT auto-rotation relies on WP-cron firing — [VERIFY] the client's WP-cron runs.

### Observability & safety net (M1)

- [ ] Error visibility: at minimum Vercel runtime logs reviewed; ideally an error tracker wired ([VERIFY] whether Sentry/PostHog captures server errors — PostHog is server-side forwarding only today).
- [ ] A **rollback plan**: redeploy previous Vercel build = instant app rollback; document how to handle a bad migration (migrations are forward-only + manual — no auto-rollback, so take a Supabase backup before applying any migration during beta).
- [ ] A lightweight uptime check on the prod URL.
- [ ] Someone owns "watch it" during beta (informal on-call).

### Explicitly DEFERRED past M1 (don't block beta on these)

- Public self-serve signup. · Full role taxonomy beyond the closed SEC-001 check. · Search-proxy scaling (Postgres-per-keystroke) + durable event buffer. · Migration timestamp de-duplication + schema-debt paydown (CLAUDE.md §17). · Legal pages / consent. · Billing.

---

## M2 — Full public launch (after M1 is stable)

### Security & auth
- [ ] Role taxonomy enforced: tenant `admin` vs `member`; funnel per-tenant + shared-table writes role-gated (retire `tenant_write_all` and the un-gated service-role writes — CLAUDE.md §17).
- [ ] **Public signup flow** live (admin-provisioned vs open self-signup per `user-management.md` — confirm the intended model) with email verification + abuse protection.
- [ ] SSO hardened (Google + Microsoft) per `user-management.md`; pre-created-email gate if that's the model.
- [ ] Rate limiting on public endpoints (search proxy, prospectos public API `record_diagnostic_request` already rate-limits — extend the pattern).
- [ ] Security review / pen test of the multi-tenant boundary and the public diagnostic API.

### Quality & testing
- [x] CI test gating re-enabled (2026-07-14; suite green 183/183, PR #262).
- [ ] Decide whether the live-storefront E2E tier should gate CI, and repoint it at a live instance first (see Instance hygiene).
- [ ] Smoke workflow (`smoke.yml`) green and required.

### Scale & reliability
- [ ] Search proxy + event ingest at scale: pooled Postgres connections, move the rate-limiter off Postgres (Redis), Meilisearch timeout + circuit breaker, **durable event buffer** so revenue-feeding events aren't lost (`docs/design/search-proxy-event-pipeline.md`). Decide the open question: extract the proxy/ingest as a separate service.
- [ ] Unified findings + monitoring layer decisions closed (`docs/design/unified-findings-and-monitoring.md`): monitor scheduling, identity model, the required `search-events.md` amendment.
- [ ] Define + monitor SLOs; alerting + real on-call.

### Data & schema hygiene
- [ ] **Reconcile the migration files with the live schema** (`supabase db pull` → baseline) so the repo can rebuild the DB. This is the biggest remaining structural debt.
- [ ] De-duplicate migration timestamps — now **4** collisions, up from 2: `20260509000005`, `20260519000001`, `20260519000002`, `20260627000005`. A clean `supabase db reset` is not reproducible while these stand.
- [ ] Pay down CLAUDE.md §17 debt: rename `tenant_tenant_id_seq`; promote `instance.kind`/`tenant.kind` to enums and drop the deprecated column; catalog vs funnel RLS template-fallthrough decision; quantity-attribute dimension filtering.
- [ ] Consider automated migration apply in CI/CD (today it's manual via Supabase MCP).
- [ ] Drop the `graveyard.wazu_*` schema once the stability window closes.
- [ ] Stand up the deferred-work registry (`docs/policy/backlog-registry.md`).

### Legal / compliance / business
- [ ] Terms of Service, Privacy Policy, data-processing terms.
- [ ] Cookie/consent banner for GA4 + analytics (storefront and app).
- [ ] Data retention + deletion / export (GDPR-style) story.
- [ ] Billing / subscription (Stripe is the named next integration in the adapter pattern, CLAUDE.md §7) if monetizing at launch.
- [ ] Support channel + status page + incident process.

### Docs hygiene
- [ ] Refresh the stale snapshots so they stop misleading: `repo-inventory.md` (Apr 25 — says "no Tailwind/shadcn", false) and `docs/state/in-flight.md` (May 17). `CLAUDE.md` is the current source of truth.
- [ ] CLAUDE.md §2 says "RLS reads `instance_id` from the JWT claim" — **incorrect**. `current_instance_id()` reads the `instance_member` table (`WHERE is_current = true`). Fix, because it misleads anyone reasoning about the isolation boundary.

---

## Appendix — env var quick reference

**Required (app won't fully work without):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MEILISEARCH_HOST`, `MEILISEARCH_MASTER_KEY`, `ANTHROPIC_API_KEY` (blog/prospectos), `CRON_SECRET`.

**Feature-gated (safe to leave unset = no-op):** `GOOGLE_OAUTH_REDIRECT_URI`, `PROSPECTOS_BROWSER_PROBE_ENABLED`, `BROWSERLESS_HOST`, `BROWSERLESS_TOKEN`, `PROSPECTOS_PSI_ENABLED`, `GOOGLE_PSI_API_KEY`, `ASE_API_URL`, `PROSPECTOS_V5_ENABLED`, `REPLICATE_API_TOKEN`, `CALCOM_WEBHOOK_SECRET`, `KLAVIYO_PRIVATE_API_KEY`, `POSTHOG_API_KEY`, `POSTHOG_HOST`.

**Auto-set by Vercel:** `NEXT_PUBLIC_BUILD_SHA`, `NEXT_PUBLIC_BUILD_DATE`.

**Test/tuning only:** `MEILISEARCH_TASK_WAIT_MS`, `WEBHOOK_URL`, `WC_TEST_CONSUMER_SECRET`, `VERBOSE`, `STOREFRONT_URL`.

> Maintenance: when an item closes, check it off in the PR that closes it. When scope changes, update the two-milestone table. This is a living doc, not a one-time snapshot.
