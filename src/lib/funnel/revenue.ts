import type { ComputedModel } from "./types";

/**
 * Per-stage revenue and SKU-item projections, treating the selected stage
 * as the starting point of the scenario:
 *
 *   converts_pct  = purchase_reach / stage_reach   (special-cased for
 *                   the terminal stages: drop = 0, purchase = 100)
 *   lost_pct      = 100 − converts_pct
 *   converted_orders = monthly_traffic × converts_pct
 *   lost_orders      = monthly_traffic × lost_pct
 *   revenue          = converted_orders × average_order_value
 *   lost_revenue     = lost_orders × average_order_value
 *   sku_items_purchased = converted_orders × average_cart_skus
 *   sku_items_lost      = lost_orders × average_cart_skus
 *
 * Units / SKU items are rounded to integers. Revenues are kept as floats
 * — the consumer formats them.
 */
export type StageRevenue = {
  convertsPct: number;
  lostPct: number;
  convertedOrders: number;
  lostOrders: number;
  revenue: number;
  lostRevenue: number;
  estimatedSkuItemsPurchased: number;
  estimatedSkuItemsLost: number;
};

export function revenueFromStage({
  stageSlug,
  model,
  monthlyTraffic,
  averageOrderValue,
  averageCartSkus,
}: {
  stageSlug: string;
  model: ComputedModel;
  monthlyTraffic: number;
  averageOrderValue: number;
  averageCartSkus: number;
}): StageRevenue {
  const stageReach = model.reach[stageSlug] ?? 0;
  const purchaseReach = model.reach["purchase"] ?? 0;

  let convertsPct: number;
  if (stageSlug === "drop") {
    convertsPct = 0;
  } else if (stageSlug === "purchase") {
    convertsPct = 100;
  } else if (stageReach > 0) {
    convertsPct = (purchaseReach / stageReach) * 100;
  } else {
    convertsPct = 0;
  }

  const lostPct = 100 - convertsPct;
  const convertedOrders = Math.round(monthlyTraffic * (convertsPct / 100));
  const lostOrders = Math.round(monthlyTraffic * (lostPct / 100));

  return {
    convertsPct,
    lostPct,
    convertedOrders,
    lostOrders,
    revenue: convertedOrders * averageOrderValue,
    lostRevenue: lostOrders * averageOrderValue,
    estimatedSkuItemsPurchased: Math.round(convertedOrders * averageCartSkus),
    estimatedSkuItemsLost: Math.round(lostOrders * averageCartSkus),
  };
}
