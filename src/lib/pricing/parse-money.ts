/**
 * Parse a money-shaped value out of a spreadsheet cell.
 *
 * Provider price lists in the target market arrive with mixed conventions:
 *   "Q 1,234.56"  – US-style with currency
 *   "1.234,56"    – LATAM
 *   "1234.56"     – plain dot
 *   "1234,56"     – plain comma
 *   "1,234,567"   – US thousands, no decimals
 *   "1.234.567"   – LATAM thousands, no decimals
 *
 * Rule:
 *   - If both `.` and `,` are present, the LAST one is the decimal separator;
 *     strip the others as thousand separators.
 *   - If only one of the two is present, treat it as the decimal separator.
 *   - If a separator is repeated (no other separator present), treat all of
 *     them as thousand separators.
 *
 * Returns `null` for empty / unparseable cells so callers can decide whether
 * that row is skipped or surfaced as an error.
 */
export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const s = String(raw).trim();
  if (s === "") return null;

  // Strip currency symbols, whitespace, parentheses, and any letter-like
  // glyphs ("Q", "GTQ", "USD", "$", "€"). Keep digits, commas, dots and a
  // leading minus sign.
  const cleaned = s
    .replace(/[^0-9.,\-]/g, "")
    .replace(/^-+/, "-") // collapse multiple leading minuses
    .replace(/-(?!$)/g, (m, offset) => (offset === 0 ? m : "")); // drop interior minuses

  if (cleaned === "" || cleaned === "-") return null;

  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;

  let normalised: string;
  if (dotCount > 0 && commaCount > 0) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastDot > lastComma) {
      // 1,234.56 → strip commas, keep dot
      normalised = cleaned.replace(/,/g, "");
    } else {
      // 1.234,56 → strip dots, swap comma for dot
      normalised = cleaned.replace(/\./g, "").replace(",", ".");
    }
  } else if (dotCount > 1) {
    // 1.234.567 → all dots are thousand separators
    normalised = cleaned.replace(/\./g, "");
  } else if (commaCount > 1) {
    // 1,234,567 → all commas are thousand separators
    normalised = cleaned.replace(/,/g, "");
  } else if (commaCount === 1) {
    normalised = cleaned.replace(",", ".");
  } else {
    normalised = cleaned;
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}
