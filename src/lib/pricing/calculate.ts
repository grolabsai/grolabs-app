/**
 * Pricing math — single source of truth for translating between cost,
 * percentage, and price across both calculation modes.
 *
 * The instance-level setting (instance.pricing_config.calculation_mode)
 * picks one of two interpretations:
 *
 *   margin: percentage is share of the *selling price* that's profit.
 *           Price  = Cost / (1 − pct/100)
 *           pct%   = (Price − Cost) / Price × 100
 *
 *   markup: percentage is share of the *cost* added on top.
 *           Price  = Cost × (1 + pct/100)
 *           pct%   = (Price − Cost) / Cost × 100
 *
 * Centralising this prevents the kind of bug where the worksheet uses one
 * formula and the violation-check uses the other.
 */

export type CalculationMode = "margin" | "markup";

/** Compute a target selling price from a cost and a percentage. */
export function targetPriceFromCost(
  cost: number,
  pct: number,
  mode: CalculationMode,
): number {
  if (!Number.isFinite(cost) || cost < 0) return 0;
  if (!Number.isFinite(pct)) return 0;

  if (mode === "margin") {
    // Margin can't reach 100% — that would imply infinite price.
    if (pct >= 100) return Infinity;
    return cost / (1 - pct / 100);
  }
  return cost * (1 + pct / 100);
}

/** Compute the realised percentage from a known cost + price. */
export function pctFromCostAndPrice(
  cost: number,
  price: number,
  mode: CalculationMode,
): number {
  if (!Number.isFinite(cost) || !Number.isFinite(price)) return 0;
  if (cost < 0 || price <= 0) return 0;

  if (mode === "margin") {
    return ((price - cost) / price) * 100;
  }
  if (cost === 0) return 0;
  return ((price - cost) / cost) * 100;
}
