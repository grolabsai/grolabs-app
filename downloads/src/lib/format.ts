/**
 * Format a price in Guatemalan quetzales. Example: 245 → "Q 245.00".
 * Phase 1 is GTQ-only per the tenant's default_currency.
 *
 * Handles null/undefined for variants with missing pricing — returns an
 * em-dash placeholder so tables don't collapse.
 */
export function formatGTQ(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `Q ${n.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Human-readable Spanish relative time. Like "hace 2h" / "hace 3d".
 * Keeps the vibe of the Bloom design where updated columns are tight.
 */
export function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = input instanceof Date ? input : new Date(input);
  if (isNaN(date.getTime())) return "—";
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "hace un momento";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months}mes`;
  const years = Math.floor(days / 365);
  return `hace ${years}a`;
}

/**
 * Two-character initials for the placeholder product thumbnail.
 * Takes the first letter of the first two words, uppercased.
 */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ?? "").join("").toUpperCase() || "··";
}
