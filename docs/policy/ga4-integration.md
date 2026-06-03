---
application: core-app
module: Policy
title: "GroLabs GA4 Integration — v1"
status: Active
owner: "Tuncho"
scope: "Read-only Google Analytics 4 integration. Daily snapshot pull into GroLabs's DB plus on-demand real-time queries. Alert pipeline for the top three traffic-health metrics. Daily-digest dashboard surface for the rest."
audience: "Claude Code (primary), future GroLabs contributors (secondary)"

actors:
  - name: GA4
    type: integration
    definition: Google Analytics 4 — the read-only external source of site-traffic data.
  - name: Polling job
    type: system
    definition: Cron-driven job (every 6h per active instance) that pulls daily snapshots and upserts the five ga4_*_daily tables.
  - name: Alert job
    type: system
    definition: Anomaly-detection job that runs after polling and drives the ga4_alert lifecycle.
  - name: Merchant
    type: human
    definition: The solopreneur viewing the daily-digest traffic cockpit; connects GA4 via OAuth and acknowledges alerts.

users:
  - name: Solopreneur
    description: Wants a daily-digest cockpit that surfaces what changed in site traffic without forcing them to learn GA4.

integrations:
  - name: GA4 Data API
    kind: external-service
    target: ga4
    direction: in
    purpose: Daily snapshot pull of session, traffic, page, geo, and device grains.
  - name: GA4 Realtime API
    kind: external-service
    target: ga4
    direction: in
    purpose: Live "Active Users right now" widget, hit directly (not from the DB), 30s refresh.
  - name: Google OAuth 2.0
    kind: external-service
    target: google
    direction: both
    purpose: Server-side auth flow with scope analytics.readonly; exchanges code for refresh + access tokens.
  - name: Supabase Vault
    kind: internal-module
    target: vault
    direction: both
    purpose: Stores the GA4 refresh token; read via the ga4_get_refresh_token RPC gated by instance_member.
  - name: Vercel Cron
    kind: external-service
    target: cron
    direction: in
    purpose: Drives the 6-hourly polling job.
  - name: Notification UI
    kind: internal-module
    target: notifications
    direction: out
    purpose: Surfaces firing GA4 alerts.

credentials:
  - name: ga4_refresh_token_<instance_id>
    location: Supabase Vault
    scope: analytics.readonly
    rotation: Access tokens are short-lived; the polling job refreshes them as needed.
  - name: GOOGLE_CLIENT_ID
    location: Server env var (Vercel + .env.local)
    scope: Google OAuth client
  - name: GOOGLE_CLIENT_SECRET
    location: Server env var (Vercel + .env.local)
    scope: Google OAuth client

rules:
  - id: R-1
    statement: The integration is read-only; GroLabs never writes data back to GA4.
    truth: true
    rationale: None of the GA4 API surfaces used support write-back.
  - id: R-2
    statement: Daily-aggregated metrics live in GroLabs's DB; only the "Active Users right now" widget hits the GA4 Realtime API live.
    truth: true
    rationale: Hybrid storage unlocks fast reads, anomaly baselines, and resilience to GA4 access loss.
  - id: R-3
    statement: Snapshots use one table per dimension grain (session, traffic, page, geo, device), not an EAV shape.
    truth: true
  - id: R-4
    statement: The pipeline polls every 6 hours per active instance and re-pulls the trailing 3 days because GA4 finalizes data 24–48 hours late.
    truth: true
  - id: R-5
    statement: Re-runs are idempotent — composite uniqueness on (instance_id, date, <dimensions>) with upsert on conflict; re-pulls overwrite, never duplicate.
    truth: true
  - id: R-6
    statement: The refresh token is stored in Supabase Vault, never plaintext in integrations_config.
    truth: true
  - id: R-7
    statement: The top-3 alert metrics are fixed in v1 — sessions ±15% vs 7-day rolling average, engagement rate −10pp absolute drop, and source/medium share shift >20pp.
    truth: true
    rationale: Merchant-configurable thresholds are deferred to v3.
  - id: R-8
    statement: A given (instance_id, metric, dimension_key) can have only one firing alert at a time; subsequent breaches update the same row rather than inserting duplicates.
    truth: true
  - id: R-9
    statement: Alert lifecycle is firing → acknowledged → cleared; an alert auto-clears when its metric returns within threshold.
    truth: true
  - id: R-10
    statement: The multi-tenancy boundary is instance_id; RLS gates every ga4_* row to the user's instance.
    truth: true

useCases:
  - id: T-1
    title: Unconnected instance shows a connect CTA
    given: An instance with no GA4 connected
    when: The /dashboard/traffic screen renders
    then: It shows a "Conectar Google Analytics" CTA with no errors
  - id: T-2
    title: Polling re-run is idempotent
    given: The five daily tables already hold data for the trailing window
    when: The polling job re-runs within the same window
    then: Rows upsert cleanly with no duplicates
    verifies: [R-5]
  - id: T-3
    title: A sessions drop fires an alert
    given: A 7-day baseline exists
    when: Sessions drop 30% versus baseline
    then: A ga4_alert row is inserted with status firing
    verifies: [R-7]
  - id: T-4
    title: Re-running anomaly detection does not duplicate a firing alert
    given: A firing alert already exists for the metric
    when: The anomaly job re-runs while it is still breached
    then: The existing row is updated, not duplicated
    verifies: [R-8]
  - id: T-5
    title: A recovered metric clears its alert
    given: A firing sessions alert
    when: Sessions return to within threshold on the next pull
    then: The alert transitions to cleared
    verifies: [R-9]
  - id: T-6
    title: Realtime widget degrades gracefully
    given: The GA4 Realtime API is unreachable
    when: The "Active Users right now" widget refreshes
    then: It shows "—" rather than an error
---

# GroLabs GA4 Integration — v1

Status: Active policy
Owner: Tuncho
Scope: Read-only Google Analytics 4 integration. Daily snapshot pull into GroLabs's DB plus on-demand real-time queries. Alert pipeline for the top three traffic-health metrics. Daily-digest dashboard surface for the rest.
Audience: Claude Code (primary), future GroLabs contributors (secondary)

This document is the authoritative spec for v1 of the GA4 integration. Read it before writing any code. Stop at the two `APPROVAL REQUIRED` checkpoints (§10 and §11) and wait for explicit approval.

## 1. Goals and non-goals

### Goal
Give a solopreneur a daily-digest cockpit for site traffic that surfaces *what changed* without forcing them to learn GA4. Three layers:

1. **Alerts** for the top-3 traffic-health metrics — pushed to GroLabs's notification surface when thresholds are breached.
2. **Daily digest screen** showing those three plus a small set of awareness metrics, with WoW comparison.
3. **Browse views** with faceted filters for everything else (deferred to v2).

### Non-goals
- Real-time anomaly detection beyond rolling-average thresholds (v3)
- Cross-dimension root-cause analysis ("traffic dropped because page X stopped ranking") — v3
- Email/SMS alerts beyond in-app — v3
- Browse views with faceted filters for non-top-3 metrics — v2
- Conversion / e-commerce event tracking from GA4 — separate policy if pursued
- Writing data back to GA4 (none of the API surfaces we use support that anyway)

## 2. Architectural decisions (locked)

If implementation surfaces a flaw, raise it as a question — don't work around it silently.

**Hybrid storage.** Daily snapshots live in GroLabs's DB; the GA4 Realtime API is hit live for the "Active Users right now" widget only. Anything aggregated daily lives in our tables. This unlocks fast reads, anomaly baselines, and resilience to GA4 access loss; it costs us a polling job and ~25 metrics × N dimensions × ~365 days/year of storage (trivial size).

**One table per dimension grain, not EAV.** `ga4_session_daily`, `ga4_traffic_daily`, `ga4_geo_daily`, `ga4_page_daily`, `ga4_device_daily`. Each table has `(instance_id, date, <dimension columns>, <metric columns>)`. Cleaner queries than EAV-style "metric_name + value" rows; type-safe; indexable.

**Polling, not webhooks.** GA4 doesn't push. Cron-style poll every 6 hours per active instance with valid GA4 credentials. Each run re-pulls the trailing 3 days because GA4 finalizes data 24-48 hours late.

**Idempotent re-runs.** Composite uniqueness on `(instance_id, date, <dimensions>)` per table; upsert on conflict. Re-pulls overwrite, never duplicate.

**Server-side OAuth with refresh-token storage.** Standard Google OAuth 2.0 server flow. Refresh token stored in Supabase Vault (same pattern as Algolia admin keys). Access tokens are short-lived; the polling job refreshes as needed.

**Alerts are first-class, not a side-effect.** Dedicated `ga4_alert` table with an explicit lifecycle (`firing → acknowledged → cleared`). GroLabs's notification UI surfaces them. Anomaly logic is its own job that runs after the polling job completes.

**Top-3 alert metrics are fixed in v1.** Sessions (with WoW threshold ±15%), Engagement Rate (absolute drop −10%), and Source/Medium share shift (any source moves >20pp). Merchant-configurable thresholds are v3.

**Code lives at `src/lib/integrations/ga4/`.** New top-level integration namespace, sibling to `src/lib/sync/` and `src/lib/import/woocommerce/`.

**UI lives at `/dashboard/traffic`.** New sub-route under the existing dashboard, not a top-level nav entry. The existing `/dashboard` (no-results analytics from Algolia) becomes one card on a multi-card dashboard surface — see the dashboard design brief at `docs/design/dashboard.md`.

**Multi-tenancy boundary uses `instance_id`,** consistent with all other GroLabs tables. RLS gates rows to the user's instance.

## 3. Schema additions

Five tables for daily snapshots, one for alerts. Applied via Supabase MCP, verified via `information_schema`.

```sql
-- Session-grain daily metrics. One row per (instance, date).
create table ga4_session_daily (
  instance_id   bigint not null references instance(instance_id),
  date          date   not null,
  sessions                  int  not null default 0,
  users                     int  not null default 0,
  active_users              int  not null default 0,
  new_users                 int  not null default 0,
  returning_users           int  not null default 0,
  engaged_sessions          int  not null default 0,
  engagement_rate           numeric(5,4) not null default 0,   -- 0..1
  avg_engagement_time_sec   numeric(10,2) not null default 0,
  avg_session_duration_sec  numeric(10,2) not null default 0,
  views                     int  not null default 0,
  views_per_session         numeric(8,2) not null default 0,
  pulled_at     timestamptz not null default now(),
  primary key (instance_id, date)
);

-- Traffic-acquisition grain. One row per (instance, date, source, medium, campaign, default_channel).
create table ga4_traffic_daily (
  instance_id          bigint not null references instance(instance_id),
  date                 date   not null,
  source               text   not null default '(direct)',
  medium               text   not null default '(none)',
  campaign             text   not null default '(not set)',
  default_channel_grouping text not null default '(other)',
  sessions             int    not null default 0,
  engaged_sessions     int    not null default 0,
  users                int    not null default 0,
  pulled_at            timestamptz not null default now(),
  primary key (instance_id, date, source, medium, campaign, default_channel_grouping)
);

-- Page-grain daily metrics. Top-N landing/exit pages.
create table ga4_page_daily (
  instance_id      bigint not null references instance(instance_id),
  date             date   not null,
  page_path        text   not null,
  views            int    not null default 0,
  entrances        int    not null default 0,    -- landing-page count
  exits            int    not null default 0,    -- exit-page count
  avg_engagement_time_sec numeric(10,2) not null default 0,
  pulled_at        timestamptz not null default now(),
  primary key (instance_id, date, page_path)
);

-- Geographic grain. Country + city.
create table ga4_geo_daily (
  instance_id  bigint not null references instance(instance_id),
  date         date   not null,
  country      text   not null default '(not set)',
  city         text   not null default '(not set)',
  language     text   not null default '(not set)',
  sessions     int    not null default 0,
  users        int    not null default 0,
  pulled_at    timestamptz not null default now(),
  primary key (instance_id, date, country, city, language)
);

-- Device / browser / OS / screen grain.
create table ga4_device_daily (
  instance_id        bigint not null references instance(instance_id),
  date               date   not null,
  device_category    text   not null default '(not set)',
  browser            text   not null default '(not set)',
  operating_system   text   not null default '(not set)',
  screen_resolution  text   not null default '(not set)',
  sessions           int    not null default 0,
  users              int    not null default 0,
  pulled_at          timestamptz not null default now(),
  primary key (instance_id, date, device_category, browser, operating_system, screen_resolution)
);

-- Alert state. Lifecycle: firing → acknowledged → cleared.
create table ga4_alert (
  alert_id        bigserial primary key,
  instance_id     bigint not null references instance(instance_id),
  metric          text   not null,                  -- 'sessions' | 'engagement_rate' | 'traffic_share'
  dimension_key   text,                             -- e.g. 'source/medium=google/organic' (null for top-line metrics)
  baseline_value  numeric not null,
  observed_value  numeric not null,
  delta_pct       numeric not null,                 -- signed: -15.0 means dropped 15%
  status          text   not null default 'firing', -- firing | acknowledged | cleared
  fired_at        timestamptz not null default now(),
  acknowledged_at timestamptz,
  cleared_at      timestamptz
);

create index ix_ga4_alert_instance_status on ga4_alert(instance_id, status, fired_at desc);

-- All tables: enable RLS, instance_isolation policies (same pattern as other catalog tables).
```

GA4 OAuth credentials stored in `instance.integrations_config.ga4 = {property_id, oauth_account_email, refresh_token_vault_ref}`. The refresh token itself goes through Supabase Vault — never plaintext in `integrations_config`.

## 4. OAuth + credential storage

Standard Google OAuth 2.0 server-side flow:

1. User clicks "Conectar Google Analytics" on `/configuration/ga4`.
2. Redirect to Google's consent screen with scope `https://www.googleapis.com/auth/analytics.readonly`.
3. Callback at `/api/v1/integrations/ga4/callback` exchanges code for refresh + access tokens.
4. Refresh token stored via `vault.create_secret(refresh_token, name=ga4_refresh_token_<instance_id>)`.
5. Property ID + OAuth account email stored in `instance.integrations_config.ga4`.
6. RPC `ga4_get_refresh_token(p_instance_id)` reads from Vault, gated by `instance_member` membership.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are server env vars (added to Vercel + `.env.local`).

## 5. Polling pipeline

Cron-driven (Vercel Cron or similar): every 6 hours for each instance with active GA4 credentials.

For each instance:
1. Refresh access token via stored refresh token.
2. For dates `(today - 3, today - 2, today - 1, today)`:
   - Pull session-grain metrics → upsert into `ga4_session_daily`.
   - Pull traffic-grain (source, medium, campaign, default_channel) → upsert into `ga4_traffic_daily`.
   - Pull page-grain (top 50 by views) → upsert into `ga4_page_daily`.
   - Pull geo-grain → upsert into `ga4_geo_daily`.
   - Pull device-grain → upsert into `ga4_device_daily`.
3. Run anomaly detection job (§6).
4. Update `instance.integrations_config.ga4.last_pull_at`.

Errors per pull are logged but don't abort the run for other instances. Per-pull HTTP calls are independent transactions.

## 6. Alert pipeline (top 3 metrics)

Runs after polling. For each instance:

**Alert 1 — Sessions ±15% vs 7-day rolling average.**
- Compute baseline: average daily sessions over previous 7 days excluding today.
- Compute observed: yesterday's sessions (most-recent finalized day).
- If `|observed - baseline| / baseline > 0.15`: insert/update `ga4_alert` row with `metric='sessions'`, status `firing`. If a `firing` row already exists for this metric within the last 7 days, update it instead (don't spam).

**Alert 2 — Engagement Rate −10pp absolute drop.**
- Baseline: average engagement_rate over previous 7 days excluding today.
- Observed: yesterday's engagement_rate.
- If `baseline - observed > 0.10`: fire alert `metric='engagement_rate'`.

**Alert 3 — Source/Medium share shift > 20pp.**
- Baseline: each source/medium's share of total sessions over previous 7 days.
- Observed: each source/medium's share yesterday.
- For each source/medium present in either window: if `|baseline_share - observed_share| > 0.20`, fire alert `metric='traffic_share'` with `dimension_key='source/medium=X/Y'`.

**Auto-clearing.** When the polling job runs and a previously-firing alert's metric returns to within threshold, transition that row to `cleared`. The user can also manually `acknowledge` an alert from the UI.

**Throttling.** A given `(instance_id, metric, dimension_key)` can only have one `firing` row at a time. Subsequent breaches update the same row's `observed_value` and `fired_at`.

## 7. Real-time widget

The "Active Users right now" widget on the daily digest screen calls the GA4 Realtime API directly (not from our DB). Refresh interval: 30s. Uses the same OAuth access token. Gracefully degrades to "—" if the API is unreachable.

## 8. Daily digest screen at `/dashboard/traffic`

Layout per `docs/design/dashboard.md`. Functional content:

- **Active users right now** widget (live, 30s refresh)
- **Three alert tiles** for the top-3 metrics — green when within threshold, red/yellow when firing
- **Sessions chart**: last 14 days, line graph, with the 7-day rolling avg overlaid
- **Engagement rate chart**: last 14 days
- **Top channels card**: today's mix (default channel grouping) with WoW arrows per channel
- **Top landing pages** (top 5): pagepath + entrances + WoW
- **Top exit pages** (top 5): pagepath + exits + WoW
- **Geo top 5** (countries by sessions)
- **Active alerts inbox** at bottom — list of `firing` alerts with "Acknowledge" button

Alerts also appear in GroLabs's global notification UI (if/when one exists) — for v1, dedicated panel on this screen is sufficient.

## 9. Test cases

- Instance with no GA4 connected → page renders with a "Conectar Google Analytics" CTA, no errors.
- OAuth flow happy path → returns to `/configuration/ga4` showing connected status + property ID.
- OAuth callback failure (user denies, network error, code expired) → friendly error, retry CTA.
- Polling job with valid credentials → all 5 daily tables populated for trailing 3 days.
- Polling job re-run within the same window → upserts cleanly, no duplicates.
- Polling job when GA4 returns 0 rows for a date → row inserted with all zeros (so the timeline shows no gap).
- Anomaly job: sessions drop 30% vs baseline → alert row inserted with status `firing`.
- Anomaly job re-run while alert is firing → updates existing row, doesn't insert duplicate.
- Anomaly job: sessions return to baseline → existing alert transitions to `cleared`.
- Daily digest screen renders all panels with no JS errors when data is fully populated.
- Daily digest screen handles "first day, no baseline yet" gracefully (don't divide by zero).
- Real-time widget: API success → shows count. API failure → shows "—".
- Real-time widget: instance not connected to GA4 → widget hidden, not shown as error.

## 10. APPROVAL REQUIRED — Checkpoint 1
Before writing code:
1. Confirm understanding of all decisions in this document.
2. Identify ambiguities or contradictions and ask clarifying questions.
3. Propose the file tree (migrations, lib code, OAuth route, polling job, anomaly job, server actions, admin page, dashboard page).
4. Wait for explicit approval before writing any code.

## 11. APPROVAL REQUIRED — Checkpoint 2
After code is written:
1. Run all test cases in §9 against a real GA4 property (Wazú's, or a test property).
2. Report pass/fail with reasons for any failures.
3. Wait for explicit approval before merging to main.

## 12. Out of scope (future policies)

- `ga4-anomaly-v2.md` — seasonality-aware anomaly detection (not just rolling avg)
- `ga4-browse-views.md` — faceted browse for the awareness metrics (device, browser, OS, language, etc.)
- `ga4-merchant-thresholds.md` — let merchants configure their own alert thresholds
- `ga4-root-cause.md` — cross-dimension hint engine ("sessions dropped because google/organic dropped on page X")
- `notifications-channels.md` — email + SMS alert delivery beyond in-app
- `ga4-conversions.md` — conversion / e-commerce event tracking from GA4

## 13. Resolved decisions

These have been resolved through Tuncho's direction (2026-05-09):

1. **Hybrid storage**, daily snapshots in GroLabs's DB, real-time API hit live for the right-now widget.
2. **Top 3 alert metrics**: sessions, engagement rate, source/medium share shift.
3. **Default thresholds** locked in v1 (±15% sessions, −10pp engagement rate, >20pp share shift). Merchant-configurable in v3.
4. **Polling cadence**: every 6h, re-pull trailing 3 days for late-finalizing data.
5. **Alert state machine**: `firing → acknowledged → cleared`, deduplicated per (metric, dimension_key).
6. **Dashboard surface**: `/dashboard/traffic` is one section of a multi-section dashboard. The existing `/dashboard` (no-results analytics) becomes a sibling section. See `docs/design/dashboard.md` for the unified layout brief.
