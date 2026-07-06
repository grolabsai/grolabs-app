/**
 * Realtime open-cart summary (Carts tab — RRE abandoned-cart recovery).
 *
 * An "open cart" is a cart_id that has an add/checkout event but no completed
 * order and no removal; age = now − last cart event. Sourced live from
 * analytics_event via the instance_open_cart_summary RPC (no rollup — this view
 * is realtime, so it always reads current state).
 *
 * Counts and the age-bucket distribution are exact. The dollar `amount` is only
 * exact once cart events carry a subtotal (a plugin gap today); until then it's
 * an AOV × open-carts ESTIMATE, flagged via `amountEstimated`.
 */
import { createClient } from "@/lib/supabase/server";

/** Buckets by the STORE's calendar day (instance.timezone) since last cart
 *  activity — Today / Yesterday / 2 d / 3–10 d / 10–30 d — capped at 30 days
 *  (older carts are an unbounded dead tail and aren't shown). Heat ramp:
 *  two greens → yellow → orange → red. */
export const CART_BUCKETS = [
  { key: "today", color: "#b7e1a6" },   // light green — added today
  { key: "d1", color: "#5cbb4a" },      // green — 1 day
  { key: "d2", color: "#f5d033" },      // yellow — 2 days
  { key: "d3_10", color: "#ef9a3d" },   // orange — 3–10 days
  { key: "d10_30", color: "#e0483b" },  // red — 10–30 days
] as const;

export type CartBucketKey = (typeof CART_BUCKETS)[number]["key"];

export interface CartBucket {
  key: CartBucketKey;
  color: string;
  count: number;
  /** Share of open carts in this bucket, 0–100. */
  pct: number;
}

export interface CartLive {
  /** Recoverable value of open carts (exact if carts carry value, else estimated). */
  amount: number;
  /** True when `amount` is an AOV × carts estimate (carts don't carry a subtotal yet). */
  amountEstimated: boolean;
  /** Number of open carts. */
  carts: number;
  /** Six age buckets, ordered fresh → stale; pct spans the full bar to 100%. */
  buckets: CartBucket[];
  /** When this snapshot was computed (ISO) — drives the "updated" label. */
  generatedAt: string;
}

interface SummaryRow {
  carts: number; value_sum: number; aov: number;
  today: number; d1: number; d2: number; d3_10: number; d10_30: number;
}

const EMPTY: CartLive = {
  amount: 0, amountEstimated: true, carts: 0,
  buckets: CART_BUCKETS.map((b) => ({ key: b.key, color: b.color, count: 0, pct: 0 })),
  generatedAt: new Date().toISOString(),
};

export async function getCartLive(instanceId: number): Promise<CartLive> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("instance_open_cart_summary", {
    p_instance: instanceId,
  });
  if (error) {
    console.error("[carts-live] summary failed:", error.message);
    return EMPTY;
  }
  const row = (Array.isArray(data) ? data[0] : data) as SummaryRow | undefined;
  if (!row) return EMPTY;

  const carts = Number(row.carts ?? 0);
  const valueSum = Number(row.value_sum ?? 0);
  const aov = Number(row.aov ?? 0);
  const amountEstimated = valueSum <= 0;
  const amount = amountEstimated ? Math.round(aov * carts) : valueSum;

  const counts: Record<CartBucketKey, number> = {
    today: Number(row.today ?? 0),
    d1: Number(row.d1 ?? 0),
    d2: Number(row.d2 ?? 0),
    d3_10: Number(row.d3_10 ?? 0),
    d10_30: Number(row.d10_30 ?? 0),
  };
  const buckets = CART_BUCKETS.map((b) => ({
    key: b.key,
    color: b.color,
    count: counts[b.key],
    pct: carts > 0 ? (counts[b.key] / carts) * 100 : 0,
  }));

  return { amount, amountEstimated, carts, buckets, generatedAt: new Date().toISOString() };
}
