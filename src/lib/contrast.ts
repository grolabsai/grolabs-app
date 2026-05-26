/**
 * Pick a foreground class based on background luminance.
 *
 * Returns "on-light-surface" or "on-dark-surface" — the same class
 * names defined in globals.css that flip the --s-text* tokens locally.
 *
 * Use case: a component needs to render text on a background whose
 * color it picks at runtime (a brand color from the DB, a status
 * tint, a user-uploaded swatch). Drop the result into the wrapper's
 * className and child text picks up the right contrast automatically.
 *
 *   const bgColor = product.brand_color; // "#fae194"
 *   const cls = contrastClassFor(bgColor);
 *   <div className={cls} style={{ background: bgColor }}>...</div>
 *
 * For statically known token-driven backgrounds, prefer using the
 * .on-light-surface / .on-dark-surface classes directly. This helper
 * is only for runtime-decided color choices.
 *
 * The threshold (0.5 luminance) is the WCAG-style midpoint between
 * white and black — it errs on the side of dark text. Tunable below
 * if a vertical wants a different sensitivity.
 */

const LUM_THRESHOLD = 0.5;

export function contrastClassFor(bg: string): "on-light-surface" | "on-dark-surface" {
  const lum = relativeLuminance(bg);
  return lum >= LUM_THRESHOLD ? "on-light-surface" : "on-dark-surface";
}

/**
 * WCAG relative luminance for a sRGB color. Returns 0–1.
 *
 * Accepts:
 *   - "#rgb" / "#rrggbb" hex
 *   - "rgb(r, g, b)" / "rgba(r, g, b, a)"
 *
 * Unknown formats fall through to 0 (treated as dark) — keeps
 * callers from crashing on user-supplied weirdness.
 */
export function relativeLuminance(color: string): number {
  const rgb = parseRgb(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgb(color: string): [number, number, number] | null {
  const trimmed = color.trim().toLowerCase();

  // Hex — #rgb or #rrggbb
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
  }

  // rgb()/rgba()
  const rgb = trimmed.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return null;
}
