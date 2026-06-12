/**
 * Locked thresholds and tunables for the GA4 integration.
 * Per docs/policy/ga4-integration.md §2 and §6.
 *
 * Merchant-configurable thresholds are v3 — keep these as the only
 * knobs in v1.
 */

// OAuth scopes — read-only Analytics access, nothing else.
export const GA4_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  // openid + email give us the connected Google account email for the
  // status panel (avoids a second API call to /userinfo).
  "openid",
  "email",
] as const;

// Trailing window we re-pull on every poll. GA4 finalizes data 24-48h late,
// so 3 days of overlap covers the common cases without thrashing.
export const POLL_TRAILING_DAYS = 3;

// Wider window for a manual / on-save pull, so the dashboard's rolling charts
// have history immediately instead of just the last 3 days. The daily cron
// keeps refreshing the trailing window; older days persist from this backfill.
// 7 days = a full "last 7 days" view; kept modest because days are pulled
// sequentially (GA4 caps concurrent requests per property) so a much larger
// window risks the serverless function timeout. Larger backfills (30d) want a
// batched/off-request job — see the date-range work.
export const BACKFILL_DAYS = 7;

// History fetched for charts. 14 days for the rolling-avg overlay.
export const TIMESERIES_DAYS = 14;

// Top-N defaults
export const TOP_PAGES_LIMIT = 50;
export const TOP_LANDING_PAGES_DEFAULT = 5;
export const TOP_EXIT_PAGES_DEFAULT = 5;
export const TOP_GEO_DEFAULT = 5;
export const TOP_CHANNELS_DEFAULT = 8;

// Alert thresholds — locked in v1 per policy §13.3
export const SESSIONS_THRESHOLD_PCT = 0.15; // ±15% vs 7-day rolling avg
export const ENGAGEMENT_DROP_ABS = 0.10; //  baseline - observed > 0.10 (10pp)
export const SHARE_SHIFT_ABS = 0.20; //      |Δshare| > 0.20 (20pp)

// Baseline window for anomaly detection (days, excluding observed day).
export const BASELINE_DAYS = 7;

// Realtime widget
export const REALTIME_WINDOW_MINUTES = 30;

// Throttle: re-fire same alert at most once per this window even if still
// breaching (the existing row is updated in place instead).
export const ALERT_DEDUP_WINDOW_DAYS = 7;
