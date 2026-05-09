/**
 * Worksheet calculation engine — single source of truth for translating
 * cost + config into the final selling price + status badge that lands
 * on a `price_batch_item` row.
 *
 * Used by:
 *   - createBatchFromPriceList (initial calc when a batch is born)
 *   - recomputeBatch (re-calc when config changes or user clicks Recalcular)
 *   - row-edit save (recalc one row when a charm/final price changes)
 *
 * Centralising it prevents the worksheet UI and the violation check from
 * drifting apart — every code path runs the same numbers.
 */

import {
  targetPriceFromCost,
  pctFromCostAndPrice,
  type CalculationMode,
} from "@/lib/pricing/calculate";
import { applyCharm, type CharmRule } from "@/lib/pricing/charm";

/**
 * MAP rule subset the engine cares about. The full DB row carries more
 * (source, dates, notes); the engine only needs price bounds + type.
 */
export type ApplicableMapRule = {
  rule_type: "MAP_min" | "max_price" | "custom";
  min_price: number | null;
  max_price: number | null;
};

export type ComputeInput = {
  /** Unit cost from the price list. */
  cost: number;
  /**
   * Variant's current selling price (from the most recent synced batch).
   * `null` when nothing has synced yet — disables the price-change check.
   */
  current_price: number | null;
  /** Instance-level setting. */
  mode: CalculationMode;
  /** Resolved category margins (own → ancestor → defaults). */
  category_target_pct: number;
  category_min_pct: number;
  /** Charm rules ordered by sort_order. */
  charm_rules: CharmRule[];
  /**
   * MAP/max rules already filtered to this variant — every entry here is
   * known to apply to the row.
   */
  map_rules: ApplicableMapRule[];
  /** From pricing_config. */
  max_price_change_enabled: boolean;
  max_price_change_pct: number;
  /**
   * When the user has manually typed a final price (`manual_override=true`
   * on the row), pass it here. The engine returns it unchanged as
   * `final_price` — only the status is recomputed against the override.
   */
  manual_override_final_price: number | null;
};

export type ComputeOutput = {
  /** Raw price from cost + margin, before charm. */
  target_price: number;
  /** Target price after charm rule applied. */
  charm_price: number;
  /** Actual selling price — manual_override_final_price if set, else charm. */
  final_price: number;
  /** Realised margin/markup at final_price (in current calc mode). */
  margin_percent: number;
  status: "neutral" | "warning" | "critical";
  /**
   * Machine-readable reason codes. The UI maps each to a localised
   * explanation. A row may surface multiple reasons; status is the
   * highest severity among them.
   */
  status_reasons: string[];
};

export function computeBatchItem(input: ComputeInput): ComputeOutput {
  const target = targetPriceFromCost(
    input.cost,
    input.category_target_pct,
    input.mode,
  );
  const charm = applyCharm(target, input.charm_rules);
  const final =
    input.manual_override_final_price !== null
      ? input.manual_override_final_price
      : charm;
  const margin = pctFromCostAndPrice(input.cost, final, input.mode);

  const reasons: string[] = [];

  // MAP / max rules — most severe checks. We collect reasons from every
  // matching rule rather than short-circuiting; a variant might violate a
  // brand MAP and a provider max simultaneously.
  for (const rule of input.map_rules) {
    if (rule.min_price !== null && final < rule.min_price) {
      if (!reasons.includes("below_map")) reasons.push("below_map");
    }
    if (rule.max_price !== null && final > rule.max_price) {
      if (!reasons.includes("above_max")) reasons.push("above_max");
    }
  }

  // Margin checks. low_margin (critical) and under_target (warning) are
  // mutually exclusive — the merchant only needs to see the worse one.
  if (margin < input.category_min_pct) {
    reasons.push("low_margin");
  } else if (margin < input.category_target_pct) {
    reasons.push("under_target");
  }

  // Symmetric price-change guard.
  if (
    input.max_price_change_enabled &&
    input.current_price !== null &&
    input.current_price > 0
  ) {
    const changePct =
      (Math.abs(final - input.current_price) / input.current_price) * 100;
    if (changePct >= input.max_price_change_pct) {
      reasons.push("price_change_exceeds_threshold");
    }
  }

  const critical = reasons.some(
    (r) => r === "below_map" || r === "above_max" || r === "low_margin",
  );
  const warning = !critical && reasons.length > 0;

  return {
    target_price: round2(target),
    charm_price: round2(charm),
    final_price: round2(final),
    margin_percent: round2(margin),
    status: critical ? "critical" : warning ? "warning" : "neutral",
    status_reasons: reasons,
  };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
