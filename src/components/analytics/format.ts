/** Format a byte count as a short human string (KB / MB / GB). Used by the
 * index-size block to render Meilisearch's `databaseSize` without dragging
 * in a formatting library. */
export function formatBytes(bytes: number): { value: string; unit: string } {
  if (bytes < 1024) return { value: String(bytes), unit: "B" };
  if (bytes < 1024 * 1024) return { value: (bytes / 1024).toFixed(1), unit: "KB" };
  if (bytes < 1024 * 1024 * 1024)
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
  return { value: (bytes / (1024 * 1024 * 1024)).toFixed(2), unit: "GB" };
}

/** Format a relative timestamp like "hace 2 h" / "hace 3 d". Locale-agnostic
 * — the calling block translates the labels via `t()`. Returns the value
 * and the unit key (`s`, `m`, `h`, `d`) so the block picks the right
 * pluralized message. */
export function relativeAgo(iso: string | null): { value: number; unit: "s" | "m" | "h" | "d" } | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return { value: s, unit: "s" };
  const m = Math.floor(s / 60);
  if (m < 60) return { value: m, unit: "m" };
  const h = Math.floor(m / 60);
  if (h < 24) return { value: h, unit: "h" };
  const d = Math.floor(h / 24);
  return { value: d, unit: "d" };
}
