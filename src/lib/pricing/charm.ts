/**
 * Apply a charm-pricing rule to a calculated target price.
 *
 * Strategies:
 *   ends_in       — bump the price up to the nearest value whose decimal
 *                   part equals strategy_value (0.95 / 0.99 / 0.50).
 *   round_to      — round the price up to the nearest multiple of
 *                   strategy_value (5, 10, 50). Always rounds up so the
 *                   merchant never loses margin.
 *   fixed_offset  — first round up to the next whole unit, then subtract
 *                   strategy_value. Produces things like 99.95 from a
 *                   raw 99.13 with strategy_value = 0.05.
 */

export type CharmStrategy = "ends_in" | "round_to" | "fixed_offset";

export type CharmRule = {
  charm_rule_id: number;
  min_price: number;
  max_price: number | null;
  strategy: CharmStrategy;
  strategy_value: number;
  is_active: boolean;
  sort_order: number;
};

/**
 * Pick the charm rule that applies to a given price. Rules are evaluated
 * in (sort_order asc, id asc); the first whose band includes `price` wins.
 * Returns null when no active rule matches.
 */
export function findCharmRule(
  price: number,
  rules: CharmRule[],
): CharmRule | null {
  if (!Number.isFinite(price)) return null;
  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (price < rule.min_price) continue;
    if (rule.max_price !== null && price > rule.max_price) continue;
    return rule;
  }
  return null;
}

/** Apply a single charm rule to a price. Returns the unchanged price for
 *  unknown strategies so callers don't accidentally crash on bad data. */
export function applyCharmRule(price: number, rule: CharmRule): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const v = rule.strategy_value;
  if (!Number.isFinite(v) || v < 0) return price;

  switch (rule.strategy) {
    case "ends_in": {
      // Snap UP to the next value whose fractional part equals v.
      // For v = 0.99 and price = 142.86 → 142.99.
      // For v = 0.95 and price = 100.00 → 100.95.
      const wholePart = Math.floor(price);
      const candidate = wholePart + v;
      if (candidate >= price) return roundCents(candidate);
      return roundCents(wholePart + 1 + v);
    }
    case "round_to": {
      if (v === 0) return roundCents(price);
      // Round UP — never give back margin.
      return roundCents(Math.ceil(price / v) * v);
    }
    case "fixed_offset": {
      // Round up to the next whole, subtract v. Negative results clamp to 0.
      const next = Math.ceil(price);
      const out = next - v;
      return roundCents(Math.max(0, out));
    }
    default:
      return price;
  }
}

/**
 * Find + apply in one shot. If no rule matches, returns the input price
 * unchanged so the worksheet can fall back to "no charm" silently.
 */
export function applyCharm(price: number, rules: CharmRule[]): number {
  const rule = findCharmRule(price, rules);
  if (!rule) return price;
  return applyCharmRule(price, rule);
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}
