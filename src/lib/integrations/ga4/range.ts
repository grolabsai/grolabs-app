/**
 * Range vocabulary used across dashboard surfaces. Pure types/constants —
 * safe to import from client components (no server-only deps).
 *
 * Server-side fetchers re-export these from `./fetchers` for convenience.
 */

export type DashboardRange = "hoy" | "ayer" | "7d" | "30d";

export const DASHBOARD_RANGES: DashboardRange[] = ["hoy", "ayer", "7d", "30d"];

export function isDashboardRange(v: unknown): v is DashboardRange {
  return v === "hoy" || v === "ayer" || v === "7d" || v === "30d";
}
