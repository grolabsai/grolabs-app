/**
 * Stable color assignment per attribute_id, used to visually link the
 * extracted span in the source product name to the cell that received it.
 *
 * Hash an attribute_id into a fixed palette so the same attribute always
 * gets the same color in the same session. Palette size (10) handles any
 * realistic per-category attribute count without collisions; if two
 * attributes ever do collide, the consequence is purely cosmetic.
 */

export type AttributeColor = {
  /** Background fill, soft so text on top stays readable. */
  bg: string;
  /** Border accent + foreground text. */
  fg: string;
};

const PALETTE: AttributeColor[] = [
  { bg: "#dbeafe", fg: "#1e40af" }, // blue
  { bg: "#fce7f3", fg: "#9d174d" }, // pink
  { bg: "#dcfce7", fg: "#166534" }, // green
  { bg: "#fef3c7", fg: "#92400e" }, // amber
  { bg: "#ede9fe", fg: "#5b21b6" }, // purple
  { bg: "#cffafe", fg: "#155e75" }, // cyan
  { bg: "#ffe4e6", fg: "#9f1239" }, // rose
  { bg: "#ecfccb", fg: "#3f6212" }, // lime
  { bg: "#ffedd5", fg: "#9a3412" }, // orange
  { bg: "#e0e7ff", fg: "#3730a3" }, // indigo
];

export function colorForAttribute(attributeId: number | string): AttributeColor {
  const n = typeof attributeId === "number" ? attributeId : Number(attributeId);
  const safe = Number.isFinite(n) ? Math.abs(Math.floor(n)) : 0;
  return PALETTE[safe % PALETTE.length];
}
