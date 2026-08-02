---
application: core-app
module: Security
title: "Audit — tenant isolation (M1 go-live P0)"
status: Findings — 1 critical open
owner: "Tuncho"
audience: "Anyone deciding whether GroLabs is safe to put a real customer on."
scope: "Executed 2026-08-02 against the live production DB (project scout, ixbbhwtpnebrhquunege) using scripts/test-tenant-isolation.mjs. Covers tenant/instance data isolation only — not authn, not the WordPress plugins, not scale."
---

# Audit — tenant isolation

**Executed:** 2026-08-02 against the live production DB.
**Verdict:** **26/27 checks passed. One CRITICAL finding — three database views
bypass RLS entirely and expose every instance's analytics data to any
authenticated user.**

RLS itself is in good shape. The isolation model works, the escalation path
that worried me is genuinely closed, and the one failure is a bounded,
well-understood Postgres default with a one-line fix per view.

---

## Method

`npm run test:isolation -- --yes` provisions two throwaway tenants (A and B),
each with its own auth user, tenant, instance, membership and one category row,
signs in as each **with the anon key** so RLS and the JWT apply exactly as they
do in the app, then asserts in three tiers. Everything it creates is deleted
afterward, including on failure.

The run is reproducible: same command, same output shape. Three consecutive
runs produced identical findings.

---

## What passed

### Tier 1 — read/write isolation (14/14)

On real tables, RLS does what it claims:

- A user reads their own rows (positive control — so the negative results mean something).
- A user cannot read the other tenant's `category` or `instance` rows, by targeted id **or** unscoped list.
- A cross-tenant `INSERT` is rejected: `new row violates row-level security policy for table "category"`.

### Tier 2 — privilege escalation via the membership pivot (12/12)

This was the highest-value gap in the original script and the thing most worth
worrying about. Isolation hinges **entirely** on `instance_member.is_current` —
`current_instance_id()` is literally `select instance_id from instance_member
where user_id = auth.uid() and is_current = true`. Anyone who can repoint that
row inherits the target instance wholesale, and every Tier 1 pass becomes
meaningless.

All four attacks are blocked:

| Attack | Result |
|---|---|
| `UPDATE` own `instance_member.instance_id` → other instance | Blocked silently (RLS matched 0 rows) |
| `INSERT` a new `instance_member` for the other instance | Blocked with error — a guard trigger fires: *"instance N does not exist or has no tenant"* |
| `INSERT` a `tenant_member` row on the other tenant | Blocked — `new row violates row-level security policy for table "tenant_member"` |
| Role bump on a foreign membership | 0 rows touched |

**Post-conditions verified after the attacks:** `current_instance_id()` still
returns the attacker's own instance, and the other tenant's data is still
unreadable. The pivot holds.

> Note on reading the output: a blocked `UPDATE` under RLS returns **no error
> and zero rows** rather than raising. The first version of this script printed
> "UPDATE SUCCEEDED" in that case, which read as a breach when it was the
> opposite. The messages now distinguish *blocked with error*, *blocked
> silently — RLS matched 0 rows*, and *AFFECTED n ROW(S) — CRITICAL*.

---

## FINDING 1 — CRITICAL: three views bypass RLS

**Status:** open · **Severity:** critical · **Blocks:** M1 go-live

Three database objects return **every instance's rows to any authenticated
user**, regardless of membership:

| View | Rows visible to a foreign user | Instances exposed |
|---|---|---|
| `event_stream` | 287 | 16, 99999 |
| `session_assignment` | 287 | 16, 99999 |
| `metric_daily_source` | 119 | 16, 99999 |

A brand-new user, freshly provisioned, belonging to a brand-new tenant, with
exactly one row to their name, can read all of it.

### Root cause

All three are **views**, not tables:

- `event_stream` — `supabase/migrations/20260627000004_metric_rollup_views_and_refresh.sql:19`
- `session_assignment` — `20260627000004:34`, redefined in `20260705000001_instance_timezone_day_bucketing.sql:35`
- `metric_daily_source` — `20260627000005:23`, redefined in `20260704000003` and `20260719000002`

In PostgreSQL, a view executes with the privileges of its **owner**, not the
caller, unless it is explicitly created with `security_invoker = true`. The
owner here is the superuser role that ran the migration, so the view reads the
underlying tables with RLS bypassed and hands the result to whoever asked.

`security_invoker` appears **nowhere** in this repository — not in any of the
114 migrations, not in any TypeScript. These are the only three views in the
codebase, so the finding is fully bounded: **3 of 3 affected.**

### Why this is worse than the row counts suggest

Today the exposed rows belong to instance 16 (your own Shopify dev store) and
99999 (the test fixture). HPC — the real customer — is **absent from the leak
only because HPC has no event data at all**, which is itself a symptom of their
empty `storefront_domains` (see `docs/state/instances.md`).

The moment HPC's storefront starts sending events — which is precisely what
going live means — their raw event stream, session assignments and metric
sources become readable by every authenticated user on the platform. **The leak
is structural and total; it is currently invisible because the one real
customer isn't sending data yet.**

Exposed columns include `user_id`, `account_id`, `event_name`, `query_uid` and
per-day metric numerators/denominators — shopper behaviour and commercial
performance.

### Fix

One statement per view, applied as a migration:

```sql
alter view public.event_stream        set (security_invoker = on);
alter view public.session_assignment  set (security_invoker = on);
alter view public.metric_daily_source set (security_invoker = on);
```

With `security_invoker = on` the view evaluates against the caller's
privileges, so the underlying tables' RLS applies normally. `analytics_event`
and `metric_daily` are already correctly isolated (they did not appear in the
sweep), so no new policies are needed — the views just need to stop bypassing
the ones that exist.

**Verify after applying** by re-running `npm run test:isolation -- --yes`; the
Tier 3 sweep must report 0 leaks. Re-check that the dashboards still render —
if any legitimately need cross-instance reads, that caller must move to the
service-role client rather than the view keeping its bypass.

**Also add a guard:** any future `CREATE VIEW` on an instance-scoped table
needs `security_invoker = on`. Worth a line in CLAUDE.md §15's PR checklist,
because this defect is invisible in code review — the view definition looks
perfectly correct.

---

## FINDING 2 — template-instance exposure (needs adjudication, not obviously a bug)

15 tables expose **instance 0** (template) rows to a non-member:

```
brand_system  diagnostic_category  diagnostic_category_contribution
diagnostic_check  diagnostic_copy  diagnostic_profile  fix_recommendation
funnel_dataset  funnel_dataset_transition_value  funnel_friction_finding
funnel_instance  prompt_template  vertical_expected_attribute
vertical_synonym_pair  vertical_test_query
```

Most of this looks **deliberate and correct**:

- `funnel_*` — CLAUDE.md §17 documents the funnel pattern as `tenant_read` with template fallthrough on SELECT, by design.
- `prompt_template` — `blog.md` specifies instance-0 fallback for prompt resolution.
- `diagnostic_*`, `vertical_*`, `fix_recommendation` — `prospectos.md` specifies the catalog tables as "per-instance + instance-0 fallthrough".

That accounts for 14 of 15. **`brand_system` is the one I can't tie to a
policy doc** — worth confirming that template brand data is meant to be world-
readable.

No action assumed here; this is flagged for a decision, not filed as a defect.

---

## What this audit does NOT cover

Stating the limits so the passes aren't over-read:

- **Only SELECT/INSERT/UPDATE via PostgREST.** Not DELETE, not RPC surface, not Realtime subscriptions, not Storage buckets.
- **Only tables PostgREST exposes** — 105 with an `instance_id` column. Anything reachable only through server actions or the service-role client is untested here.
- **Sweep power is bounded by data presence.** A table with no rows for any other instance passes trivially. This is exactly how the three views would have hidden if instance 16 had no events — so a clean sweep is necessary, not sufficient.
- **Role semantics untested** — `admin` vs `member` within one tenant. Everything here is cross-tenant.
- **The template-owner/admin boundary** (`is_grolabs_admin()`) was verified to exist and fail closed, but not fuzzed.

---

## Recommendation

**Do not onboard a second real customer, and do not let HPC start sending
events, until Finding 1 is fixed.** It is a one-line-per-view change and the
test that proves it is already written.

Everything else in the isolation model — the part that would have been
expensive to fix — is sound.
