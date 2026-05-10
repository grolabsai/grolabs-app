import { Icon } from "@/components/ui/icon";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

/**
 * Tiny trend indicator: arrow + value + color.
 *
 * `invertedGood`: when true, downward trends render green and upward red.
 * Used for "Búsquedas sin resultados" — fewer no-results searches is better.
 *
 * Pass `unit="%"` for percent values, `unit="pp"` for percentage-point deltas
 * (e.g., engagement rate). Sign is auto-derived from `value`.
 */
export function TrendPill({
  value,
  unit = "%",
  invertedGood = false,
  decimals = 0,
  size = 13,
}: {
  value: number;
  unit?: "%" | "pp" | "" | string;
  invertedGood?: boolean;
  decimals?: number;
  size?: number;
}) {
  const eps = 0.05;
  let dir: "up" | "down" | "flat" = "flat";
  if (value > eps) dir = "up";
  else if (value < -eps) dir = "down";

  let tone: "positive" | "negative" | "neutral" = "neutral";
  if (dir === "up") tone = invertedGood ? "negative" : "positive";
  else if (dir === "down") tone = invertedGood ? "positive" : "negative";

  const color =
    tone === "positive"
      ? "var(--s-success)"
      : tone === "negative"
        ? "var(--s-danger)"
        : "var(--s-text-tertiary)";

  const ArrowIcon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const formatted = `${Math.abs(value).toFixed(decimals)}${unit}`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: size,
        fontWeight: 500,
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon icon={ArrowIcon} size={14} />
      {formatted}
    </span>
  );
}
