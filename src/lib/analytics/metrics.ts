/**
 * Conversion-Measurement Foundations (B1) — the metric catalog.
 *
 * Single source of truth for KPI *metadata* (label, grain, identity rule,
 * window, source tier, outcome family, fence, buildable status). The metric
 * *logic* lives in the `metric_daily_source` SQL view; this constant describes
 * and labels the rows it produces. `key` here MUST match `metric_key` there.
 *
 * Decision (per docs/design/conversion-measurement-foundations.md §6): the
 * catalog is a typed CODE CONSTANT, not a DB table — KPI definitions are spec,
 * identical across every instance (the "could two instances differ?" test says
 * no). Promote to a `metric_definition` table only if per-instance custom
 * metrics or an admin editor ever appear.
 *
 * See docs/design/event-tracking.md for the tracking store these read.
 */

/** Where the metric is measured. */
export type Grain = "search" | "intent" | "click" | "event" | "session" | "journey" | "user";

/** spine = event-level joinable (query_log ⟕ analytics_event); ga4 = aggregate overlay. */
export type SourceTier = "spine" | "ga4";

/** Outcome family — revenue vs internal economics must never be conflated. */
export type OutcomeFamily = "revenue" | "internal_economics" | "predictive";

/**
 * Buildable status:
 *  - now: materialized by metric_daily_source today.
 *  - needs_instrumentation: a small emit/marking change unblocks it.
 *  - later: needs an agent or identity-spanning model.
 */
export type Buildable = "now" | "needs_instrumentation" | "later";

/** rate = numerator/denominator; aggregate = a mean/median/quantity with sample_size. */
export type MetricKind = "rate" | "aggregate";

/** The fence a metric belongs to — never cross-attribute across fences. */
export type Fence = "ranking" | "pdp" | "cart" | "grain" | null;

export interface MetricDef {
  key: string;
  label: string;
  description: string;
  grain: Grain;
  sourceTier: SourceTier;
  outcomeFamily: OutcomeFamily;
  fence: Fence;
  kind: MetricKind;
  buildable: Buildable;
  /** True iff metric_daily_source currently emits this key. */
  materialized: boolean;
  unit: "ratio" | "count" | "seconds" | "rank" | "score";
  numeratorLabel?: string;
  denominatorLabel?: string;
  /** Why it isn't materialized yet (for non-`now` rows). */
  blockedReason?: string;
}

export const METRICS: readonly MetricDef[] = [
  // ── Findability — revenue, ranking fence (search tuning, no write-back) ──
  {
    key: "search_volume", label: "Search volume",
    description: "Count of committed searches.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
  },
  {
    key: "zero_result_searches", label: "Zero-result searches",
    description: "Committed searches that returned no hits.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
  },
  {
    key: "no_result_rate", label: "No-result rate",
    description: "Zero-result searches ÷ all committed searches. The catalog can't answer — fix with synonyms / expansion / add product.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "zero-result searches", denominatorLabel: "committed searches",
  },
  {
    key: "search_ctr", label: "Search CTR",
    description: "Searches-with-results that earned ≥1 click ÷ searches with results. Engagement → ranking.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "searches with a click", denominatorLabel: "searches with results",
  },
  {
    key: "no_click_rate", label: "No-click rate",
    description: "Searches-with-results and zero clicks ÷ searches with results. Results shown but irrelevant → relevance/ranking.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "results-searches with no click", denominatorLabel: "searches with results",
  },
  {
    key: "time_to_first_click_median", label: "Time-to-first-click (median)",
    description: "Median seconds from a committed search to its first click. Relevant item buried → ranking.",
    grain: "search", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "aggregate", buildable: "now", materialized: true, unit: "seconds",
  },
  {
    key: "avg_click_position", label: "Average click position",
    description: "Mean GLOBAL 0-based rank of clicked results (conditional on a click). How high the relevant item ranked.",
    grain: "click", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "aggregate", buildable: "now", materialized: true, unit: "rank",
  },
  {
    key: "mrr", label: "Mean reciprocal rank",
    description: "Mean of 1/(position+1) over clicked results. Higher = relevant items rank near the top.",
    grain: "click", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "aggregate", buildable: "now", materialized: true, unit: "score",
  },

  // ── Conversion funnel — revenue ──────────────────────────────────────────
  {
    key: "cart_to_checkout", label: "Cart → checkout",
    description: "Checkouts ÷ cart adds. Cart friction / weak intent → cart UX (largely merchant).",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "cart",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "checkouts", denominatorLabel: "cart adds",
  },
  {
    key: "checkout_to_purchase", label: "Checkout → purchase",
    description: "Purchases ÷ checkouts. Payment / trust / friction → checkout UX (merchant).",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "cart",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "orders", denominatorLabel: "checkouts",
  },
  {
    key: "search_to_purchase", label: "Search → purchase",
    description: "Orders attributed to a search ÷ committed searches. The headline search-to-revenue close rate.",
    grain: "intent", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "attributed orders", denominatorLabel: "committed searches",
  },

  // ── Conversion by grain — revenue (same metric, several units) ───────────
  {
    key: "session_conversion", label: "Session conversion",
    description: "Sessions ending in purchase ÷ sessions (30-min/day sessionization). Misleading alone — the assist trap; read with journey conversion.",
    grain: "session", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "converting sessions", denominatorLabel: "sessions",
  },
  {
    key: "user_conversion", label: "User conversion (device)",
    description: "Purchasing users ÷ active users per day, at DEVICE tier (browser id). Human tier follows account_id resolution.",
    grain: "user", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "purchasing users", denominatorLabel: "active users",
  },

  // ── PDP fence — revenue (daily ratios; no per-event attribution) ─────────
  {
    key: "click_to_pdp", label: "Click → PDP",
    description: "PDP views ÷ result clicks. The pdp-fence entry rate (daily ratio, per the fence table — not a per-click attribution join).",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "pdp",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "PDP views", denominatorLabel: "result clicks",
  },
  {
    key: "pdp_views", label: "PDP views",
    description: "Count of 'Product viewed' events (plugin v0.12.0).",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "pdp",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
  },
  {
    key: "pdp_to_cart", label: "PDP → cart",
    description: "Cart adds ÷ PDP views. Page convinces to add → PDP content enhancement.",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "pdp",
    kind: "rate", buildable: "now", materialized: true, unit: "ratio",
    numeratorLabel: "cart adds", denominatorLabel: "PDP views",
  },
  // ── Sales — revenue (from the sales_order ENTITY since _018; dedup-proof) ─
  {
    key: "total_sales", label: "Total sales",
    description: "Sum of sales_order.amount per day. The headline money number.",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
  },
  {
    key: "orders", label: "Orders",
    description: "Count of sales_order rows (keyed on order_id → dedup-proof).",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
  },
  {
    key: "aov", label: "Average order value",
    description: "Total sales ÷ orders.",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
    numeratorLabel: "total sales", denominatorLabel: "orders",
  },
  {
    key: "avg_items_per_order", label: "Avg items / order",
    description: "Sum of line quantity ÷ orders.",
    grain: "event", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "aggregate", buildable: "now", materialized: true, unit: "count",
    numeratorLabel: "units sold", denominatorLabel: "orders",
  },
  // ── Not yet materialized — tracked so the catalog is complete ────────────
  {
    key: "journey_conversion", label: "Journey conversion",
    description: "Journeys ending in purchase ÷ journeys (cart carry-over, 7-day window). The true close rate.",
    grain: "journey", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "later", materialized: false, unit: "ratio",
    blockedReason: "Journeys span days/sessions — needs an identity-spanning view, not a clean per-day grain. Deferred.",
  },
  {
    // Decision 2026-07-19 (conversion-measurement foundations §14): the old
    // "events carry no revenue amount" blocker went stale when sales_order
    // landed — revenue ÷ population is the KPI that catches basket-size
    // uplift invisible to conversion rates.
    key: "revenue_per_session", label: "Revenue / session",
    description: "Order revenue ÷ sessions. Moves when baskets grow even if conversion doesn't — the revenue-efficiency read.",
    grain: "session", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: true, unit: "count",
    numeratorLabel: "order revenue", denominatorLabel: "sessions",
  },
  {
    key: "revenue_per_user", label: "Revenue / user",
    description: "Order revenue ÷ distinct users seen that day. The per-person twin of revenue/session.",
    grain: "user", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: true, unit: "count",
    numeratorLabel: "order revenue", denominatorLabel: "users",
  },
  {
    key: "revenue_per_session_registered", label: "Revenue / session (registered)",
    description: "Order revenue from registered users ÷ their sessions (registered = any event carried account_id, per instance_user_breakdown).",
    grain: "session", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: false, unit: "count",
    blockedReason: "Needs the order→identity join (account_id classification) in metric_daily_source. Slated for the next catalog iteration.",
  },
  {
    key: "revenue_per_session_anonymous", label: "Revenue / session (anonymous)",
    description: "Order revenue from never-registered users ÷ their sessions — the complement of the registered split.",
    grain: "session", sourceTier: "spine", outcomeFamily: "revenue", fence: "grain",
    kind: "rate", buildable: "now", materialized: false, unit: "count",
    blockedReason: "Needs the order→identity join (account_id classification) in metric_daily_source. Slated for the next catalog iteration.",
  },
  {
    key: "reformulation_rate", label: "Reformulation rate",
    description: "Intents needing ≥1 rewrite ÷ intents (grouped by intent_group_id).",
    grain: "intent", sourceTier: "spine", outcomeFamily: "revenue", fence: "ranking",
    kind: "rate", buildable: "needs_instrumentation", materialized: false, unit: "ratio",
    blockedReason: "Needs intent-grain rollup over intent_group_id; v1 search metrics are per-search.",
  },
] as const;

/** Keys the metric_daily_source view currently emits. */
export const MATERIALIZED_METRIC_KEYS: readonly string[] =
  METRICS.filter((m) => m.materialized).map((m) => m.key);

export const METRIC_BY_KEY: Readonly<Record<string, MetricDef>> = Object.fromEntries(
  METRICS.map((m) => [m.key, m])
);
